console.log('Generate Feedback script started');
const fs = require('fs').promises;
const { execSync } = require("child_process");
const { OpenAI } = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const rulesPath = ".github/rules/rules.json";
const MAX_TOKENS = 4000;
const AVERAGE_LINE_CHARACTERS = 80; // Approximate average line length
const CHARACTERS_PER_TOKEN = 4; // Approximate characters per token
const RESERVED_TOKENS = 2000; // Reserve for the response
const escapeJsonString = (str) =>
    str.replace(/\\/g, '\\\\') // Escape backslashes
       .replace(/"/g, '\\"');  // Escape double quotes
  
async function generateFeedback() {
  try {
    const rulesData = await fs.readFile(rulesPath, "utf8");
    const rules = JSON.parse(rulesData);
    const diff = await fs.readFile("pr_diff.txt", "utf8");
    const changes = diff
      .split("diff --git")
      .slice(1)
      .map((change) => {
        const lines = change.split("\n");
        const filePathMatch = lines[0]?.match(/b\/(\S+)/);
        const filePath = filePathMatch ? filePathMatch[1] : null;
        if (
          !filePath ||
          filePath.includes("workflows/") ||
          filePath.includes("rules/") ||
          filePath.includes("scripts/") 
        ) {
          return null; // Skip invalid or workflow files
        }
        const header = lines.find((line) => line.startsWith("@@"));
        const position = header
          ? parseInt(header.match(/\+([0-9]+)/)?.[1], 10)
          : null;
        const addedLines = [];
        let lineCounter = position || 0;
        let originalLine = lineCounter;
        for (const line of lines) {
          if (line.startsWith("+") && !line.startsWith("+++")) {
            let commitHash;
            try {
              const blameOutput = execSync(
                `git blame -L ${lineCounter},${lineCounter} --line-porcelain HEAD -- ${filePath}`
              )
                .toString()
                .trim();
              commitHash = blameOutput.split("\n")[0].split(" ")[0];
              const originalLineMatch = blameOutput
                .split("\n")[0]
                .split(" ")[1];
              originalLine = originalLineMatch
                ? parseInt(originalLineMatch, 10)
                : lineCounter; // Fallback to current line
              console.log(
                "parsedOriginalLine: ${parseInt(originalLineMatch, 10)}"
              );
              console.log(
                `commit hash is ${commitHash}, line is : ${lineCounter}, original line is ${originalLine}`
              );
            } catch (error) {
              console.error(
                `Failed to get commit hash for ${filePath} at line ${lineCounter}:`,
                error.message
              );
              commitHash = "unknown";
            }
            addedLines.push({
              lineNumber: originalLine, // Use the original line number from blame
              lineDiff: line.slice(1),
              commitId: commitHash,
            });
            lineCounter++;
          }
        }
        if (addedLines.length === 0) {
          return null; // Skip invalid changes
        }
        return { filePath, addedLines };
      })
      .filter(Boolean); // Remove null values
    const feedbacks = [];
    for (const { filePath, addedLines } of changes) {
      let chunk = [];
      let currentTokenCount = 0;
      let chunkIndex = 1; // Initialize a counter to track chunks
      for (const line of addedLines) {
        const lineTokenEstimate = Math.ceil(
          (line.lineDiff.length || AVERAGE_LINE_CHARACTERS) /
            CHARACTERS_PER_TOKEN
        );
        if (
          currentTokenCount + lineTokenEstimate >
          MAX_TOKENS - RESERVED_TOKENS
        ) {
          // Log before sending the current chunk
          console.log(`Sending chunk ${chunkIndex} for file ${filePath}...`);

          // Process the current chunk
          const messages = [
            {
              role: "system",
              content: `You are an AI reviewing code. Your job is to identify all issues in the provided changes according to the following rules: ${JSON.stringify(rules)}. 
              - For each line of code, check against all rules and report every rule violation you find.
              - If multiple rules are violated on the same line, include all of them in the response.
              - All strings in JSON fix field that include double quotes inside strings must be properly escaped as \\".
              - Always respond with valid JSON format as described.`,
            },
            {
              role: "user",
              content: `
              Review the following changes in the filePath ${filePath}: 
              ${JSON.stringify(chunk, null, 2)}
              Respond strictly in the following JSON format:
              [
                {
                  "line": <line_number>,
                  "filePath": "<file_path>",
                  "issueDescription": "<short_description>",
                  "fix": "<code_snippet_for_all_suggested_fixes>",
                  "commitId": "<commit_id_specific_to_the_line_that_have_issue>"
                }
              ]
              If there are no issues, respond with: { "status": "pass" }`,
            },
          ];
          try {
            const response = await openai.chat.completions.create({
              model: "gpt-4",
              messages,
              max_tokens: RESERVED_TOKENS,
              n: 1,
            });
            const feedbackContent = response.choices[0].message.content;
            if (feedbackContent.trim() === '{ "status": "pass" }') {
              console.log(`No issues found for ${filePath}`);
              continue;
            }
            try {
              const parsedFeedback = JSON.parse(feedbackContent);
              parsedFeedback.forEach((item) => {
                item.fix = escapeJsonString(item.fix);
                feedbacks.push(item); // Include commitId from chunk
              });
            } catch (jsonError) {
              console.error(
                `Invalid JSON response for ${filePath}:`,
                feedbackContent,
                jsonError.message
              );
            }
          } catch (error) {
            console.error(
              `Error processing feedback for ${filePath}:`,
              error.message
            );
          }
          // Reset for the next chunk
          chunk = [];
          currentTokenCount = 0;
          chunkIndex++; // Increment the chunk counter
        }
        chunk.push(line);
        currentTokenCount += lineTokenEstimate;
      }
      // Process any remaining lines in the last chunk
      if (chunk.length > 0) {
        const messages = [
          {
            role: "system",
            content: `You are an AI reviewing code. Your job is to identify all issues in the provided changes according to the following rules: ${JSON.stringify(rules)}. 
            - For each line of code, check against all rules and report every rule violation you find.
            - If multiple rules are violated on the same line, include all of them in the response.
            - Always respond with valid JSON format as described.`,
          },
          {
            role: "user",
            content: `
            Review the following changes in the filePath ${filePath}:
            ${JSON.stringify(chunk, null, 2)}
            Respond strictly in the following JSON format:
            [
              {
                "line": <line_number>,
                "filePath": "<file_path>",
                "issueDescription": "<short_description_about_the_different_rules_violated>",
                "fix": "<code_snippet_for_all_suggested_fixes>",
                "commitId": "<commit_id_specific_to_the_line_that_have_issue>"
              }
            ]
            If there are no issues, respond with: { "status": "pass" }`,
          },
        ];
        try {
          const response = await openai.chat.completions.create({
            model: "gpt-4",
            messages,
            max_tokens: RESERVED_TOKENS,
            n: 1,
          });
          const feedbackContent = response.choices[0].message.content;
          console.log(`Raw GPT Response:`, feedbackContent);
          if (feedbackContent.trim() === '{ "status": "pass" }') {
            console.log(`No issues found for ${filePath}`);
            continue;
          }
          try {
            const parsedFeedback = JSON.parse(feedbackContent);
            parsedFeedback.forEach((item) => {
              feedbacks.push(item); // Include commitId from chunk
            });
          } catch (jsonError) {
            console.error(
              `Invalid JSON response for ${filePath}:`,
              feedbackContent,
              jsonError.message
            );
          }
        } catch (error) {
          console.error(
            `Error processing feedback for ${filePath}:`,
            error.message
          );
        }
      }
    }
    console.log(`Escaped Raw GPT Response:`, feedbacks);

    await fs.writeFile('feedbacks.json', JSON.stringify(feedbacks, null, 2), 'utf8');
    console.log('Feedbacks written to feedbacks.json');
    process.exit(0);
  } catch (error) {
    console.error("Error generating feedback:", error);
    process.exit(1);
  }
}
generateFeedback();
