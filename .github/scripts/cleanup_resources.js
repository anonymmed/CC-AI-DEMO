const fs = require("fs");
const { OpenAI } = require("openai");
const { Octokit } = require("@octokit/rest");

const cachePath = ".github/cache/cache.json";
const prId = process.env.PR_NUMBER;
const cacheKey = `${process.env.RUNNER_OS}-pr-cache-${process.env.PR_NUMBER}`; // Cache key to delete
async function deleteGithubCache() {
    try {
      const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
      const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

      console.log(`Attempting to delete cache with key: ${cacheKey}`);
      const response = await octokit.request(
        "DELETE /repos/{owner}/{repo}/actions/caches?key={cacheKey}",
        {
          owner,
          repo,
          headers: {
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );
  
      if (response.status === 200) {
        console.log(`Cache with key ${cacheKey} deleted successfully.`);
      } else {
        console.error(`Failed to delete cache. Response: ${response}`);
      }
    } catch (error) {
      console.error(`Error deleting cache: ${error.message}`);
    }
  }
  
  
(async function cleanupResources() {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  try {
    // Load cache
    if (!fs.existsSync(cachePath)) {
      console.error("Cache file not found. Skipping cleanup.");
      return;
    }

    const cacheData = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const prCache = cacheData[prId];

    if (!prCache || (!prCache.assistantId && !prCache.threadId)) {
      console.log("No assistant or thread found for this PR. Skipping cleanup.");
      return;
    }

    // Delete Assistant
    if (prCache.assistantId) {
      await openai.beta.assistants.del(prCache.assistantId);
      console.log(`Deleted Assistant: ${prCache.assistantId}`);
    }

    // Delete Thread
    if (prCache.threadId) {
      await openai.beta.threads.del(prCache.threadId);
      console.log(`Deleted Thread: ${prCache.threadId}`);
    }

    // Clear cache for the PR
    fs.promises.unlink(cachePath);
    console.log(`cleared cache.json file`);
    await deleteGithubCache();      
  } catch (error) {
    console.error("Error during cleanup:", error.message);
  }
})();
