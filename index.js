#!/usr/bin/env node

import { program } from 'commander';
import axios from 'axios';
import simpleGit from 'simple-git';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const git = simpleGit();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



const prisma = new PrismaClient();
// main func to store commit in database

async function syncChanges( username) {
    try {


        let modifiedFiles = [];
        let deletedFiles = [];
        let renamedFiles = [];
        let additionFiles = [];
        let modifiledDiffFile = []

        const gitBranch = git.branch();

        const currentBranch = (await gitBranch).current

        let repo_name = '';

        const remotes = await git.getRemotes(true);
        
        const originRemote = remotes.find(remote => remote.name === 'origin');

        if (originRemote) {
            const repoUrl = originRemote.refs.fetch;
            repo_name = repoUrl.split('/').pop().replace('.git', '');
        } 
        
        const status = await git.status();
  

        if(!currentBranch || repo_name === ''){
            console.log(chalk.red('Some error occured'));   
            return;
        }


        for (const filePath of status.modified) {
            const diffFile = await git.diff([filePath]); 
            console.log("Diff for", filePath, ":", diffFile);
            modifiledDiffFile.push({path:filePath , content: diffFile});
            const content =  fs.readFileSync(filePath , 'utf-8');
            modifiedFiles.push({path: filePath, content: content});
            if (!diffFile) {
                console.log(`No diff found for ${filePath}. It may be staged or have no changes.`);
            }
        }

        for (const filePath of status.deleted) {
            deletedFiles.push(filePath);
        }

        for (const filePath of status.renamed) {
            renamedFiles.push({from: filePath.from, to: filePath.to});
        }


        // for (const filePath of status.added) {
        //     const content = fs.readFileSync(filePath , 'utf-8')
        //     additionFiles.push({path:filePath , content:content});
        // }

        

        const commitData = {
            repo:repo_name,
            branch:currentBranch,
            username,
            createdFile:additionFiles,
            deleteFile:deletedFiles,
            modifiedFile:modifiedFiles,
            diffFile:modifiledDiffFile,
            status:'Requested'  
        }



        console.log("Commit Data :" , commitData);
        

        const res = await axios.post('http://localhost:3000/api/commit/request' , commitData);

        if(res.status === 200){
            console.log(chalk.green("Changes synced successfully."));
            return;
        }

        console.log(chalk.red("Failed to save commit: "));
        return;
        
    } catch (error) {
        console.log(chalk.red("Some error occurred: ", error));
        return;
    }
}





async function uploadChangesToGithub(repo, branch, accessToken, status , username) {

    const newCommitSha = await createTree(repo, branch, accessToken, status , username);
    
    // await updateBranchReference(repo, branch, newCommitSha, accessToken , username);
}

async function updateBranchReference(repo, branch, newCommitSha, accessToken , username) {
    try {
        await axios.patch(`https://api.github.com/repos/${username}/${repo}/git/refs/heads/${branch}`, {
            sha: newCommitSha,
            force: false,
        }, {
            headers: {
                Authorization: `token ${accessToken}`,
                'Content-Type': 'application/json',
            }
        });
        console.log(`Branch ${branch} updated to commit ${newCommitSha}`);
    } catch (error) {
        console.log("Error updating branch reference: ", error);
    }
}


async function  createTree(repo, branch, accessToken, status , username) {

    try {

        const commitSha = await getLatestCommitSha(accessToken , repo , username);



        const commitResponse = await axios.get(`https://api.github.com/repos/${username}/${repo}/git/commits/${commitSha}`, {
            headers: {
                Authorization: `token ${accessToken}`,
            },
        });

        
        const currentTreeSha = commitResponse.data.tree.sha;

        
        const existingTreeResponse = await axios.get(`https://api.github.com/repos/${username}/${repo}/git/trees/${currentTreeSha}`, {
            headers: {
                Authorization: `token ${accessToken}`,
            },
        });

        const existingFiles = existingTreeResponse.data.tree;

        
        const newTreeWithData = existingFiles.map(file => ({
            path: file.path,
            mode: file.mode,
            sha: file.sha, 
        }));

        
        for (const file of status.files) {
            const filePath = file.path;
            const fileContent = fs.readFileSync(filePath, 'utf-8');

            const blobRes = await axios.post(`https://api.github.com/repos/${username}/${repo}/git/blobs`, {
                content: fileContent,
                encoding: 'utf8',
            }, {
                headers: {
                    Authorization: `token ${accessToken}`,
                    'Content-Type': 'application/json',
                }
            });

            newTreeWithData.push({
                path: filePath,
                mode: '100644',
                sha: blobRes.data.sha, 
            });
        }

        
        const treeRes = await axios.post(`https://api.github.com/repos/${username}/${repo}/git/trees`, {
            tree: newTreeWithData,
            base_tree: currentTreeSha 
        }, {
            headers: {
                Authorization: `token ${accessToken}`,
                'Content-Type': 'application/json',
            }
        });


        const commitRes = await axios.post(`https://api.github.com/repos/${username}/${repo}/git/commits`, {
            message: "Sync changes from CLI tool",
            tree: treeRes.data.sha,
            parents: [commitSha], // Use the latest commit as a parent
        }, {
            headers: {
                Authorization: `token ${accessToken}`,
                'Content-Type': 'application/json',
            }
        });

        console.log(`Created commit: ${commitRes.data.sha}`);
        return commitRes.data.sha;

    } catch (error) {
        console.log("Error in createTree: ", error);
    }
}


async function getLatestCommitSha(accessToken , repo , username) {
    try {
        const response = await axios.get(`https://api.github.com/repos/${username}/${repo}/git/refs/heads/main`, {
            headers: {
                Authorization: `token ${accessToken}`,
            },
        });
        return response.data.object.sha;
    } catch (error) {
        console.log(error);
    }
}

program.version('1.0.0')
    .description('Sync CLI tool for syncing your staged changes with GitHub')
    .requiredOption('-u, --username <username>', 'User Name')
    .action(async (option) => {
        await syncChanges(option.username);
    });

program.parse(process.argv);
