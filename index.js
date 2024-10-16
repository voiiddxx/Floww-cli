#!/usr/bin/env node

import { program } from 'commander';
import axios from 'axios';
import simpleGit from 'simple-git';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const git = simpleGit();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function syncChanges(repo, branch, username) {
    try {
        const status = await git.status();

        if (status.staged.length === 0) {
            console.log(chalk.yellow("No changes to sync."));
            return;
        }

      

        await uploadChangesToGithub(repo, branch, token, status);
        
    } catch (error) {
        console.log(chalk.red("Some error occurred: ", error));
        return;
    }
}

async function uploadChangesToGithub(repo, branch, accessToken, status) {
    const newCommitSha = await createTree(repo, branch, accessToken, status);
    await updateBranchReference(repo, branch, newCommitSha, accessToken);
}

async function updateBranchReference(repo, branch, newCommitSha, accessToken) {
    try {
        await axios.patch(`https://api.github.com/repos/voiiddxx/${repo}/git/refs/heads/${branch}`, {
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

async function createTree(repo, branch, accessToken, status) {
    try {
        const commitSha = await getLatestCommitSha(accessToken);
        const commitResponse = await axios.get(`https://api.github.com/repos/voiiddxx/FacebookScrapper/git/commits/${commitSha}`, {
            headers: {
                Authorization: `token ${accessToken}`,
            },
        });

        // Get the current tree SHA
        const currentTreeSha = commitResponse.data.tree.sha;

        // Fetch the existing files in the current tree
        const existingTreeResponse = await axios.get(`https://api.github.com/repos/voiiddxx/FacebookScrapper/git/trees/${currentTreeSha}`, {
            headers: {
                Authorization: `token ${accessToken}`,
            },
        });

        const existingFiles = existingTreeResponse.data.tree;

        // Create a new tree with existing files and modified files
        const newTreeWithData = existingFiles.map(file => ({
            path: file.path,
            mode: file.mode,
            sha: file.sha, // Keep the existing SHA for unchanged files
        }));

        // Add modified files
        for (const file of status.files) {
            const filePath = file.path;
            const fileContent = fs.readFileSync(filePath, 'utf-8');

            const blobRes = await axios.post(`https://api.github.com/repos/voiiddxx/FacebookScrapper/git/blobs`, {
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
                sha: blobRes.data.sha, // Use the new blob SHA for modified files
            });
        }

        // Create a new tree
        const treeRes = await axios.post('https://api.github.com/repos/voiiddxx/FacebookScrapper/git/trees', {
            tree: newTreeWithData,
            base_tree: currentTreeSha // Ensure the tree is based on the current one
        }, {
            headers: {
                Authorization: `token ${accessToken}`,
                'Content-Type': 'application/json',
            }
        });

        // Create a new commit
        const commitRes = await axios.post(`https://api.github.com/repos/voiiddxx/FacebookScrapper/git/commits`, {
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


async function getLatestCommitSha(accessToken) {
    try {
        const response = await axios.get(`https://api.github.com/repos/voiiddxx/FacebookScrapper/git/refs/heads/main`, {
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
    .requiredOption('-r, --repo <repo>', 'Repository name')
    .requiredOption('-b, --branch <branch>', 'Branch name')
    .requiredOption('-u, --username <username>', 'User Name')
    .action(async (option) => {
        await syncChanges(option.repo, option.branch, option.username);
    });

program.parse(process.argv);
