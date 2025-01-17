console.log("Post Comments script started");
const fs = require("fs").promises;
const { Octokit } = require("@octokit/rest");
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
async function postComments() {
  try {
    const feedbacksData = await fs.readFile("feedbacks.json", "utf8");
    const feedbacks = JSON.parse(feedbacksData);
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
    const pull_number = process.env.PR_NUMBER;
    for (const feedback of feedbacks) {
      const { filePath, line, commitId, issuesDescription, fix } = feedback;
      if (!fix) {
        console.log("Fix is not available for the issue: ", feedback);
      }
      const body = `${filePath}:${line} \n ${issuesDescription} \n ${
        fix && fix?.length > 0 ? "\n```csharp \n" + fix + "\n ```" : ""
      }`;

      try {
        await octokit.pulls.createReviewComment({
          owner,
          repo,
          pull_number,
          body,
          path: filePath,
          position: line,
          commit_id: commitId,
        });
        console.log(`Comment posted for ${filePath} at line ${line}`);
      } catch (err) {
        console.error(
          `Failed to post comment for ${filePath}:${line}`,
          err.message
        );
      }
    }

    console.log(`All ${feedbacks.length} review comments have been posted.`);
  } catch (error) {
    console.error("Error during posting comments:", error);
    process.exit(1);
  }
}

postComments();
