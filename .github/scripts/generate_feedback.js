/*console.log('Generate Feedback script started');
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
                `line : ${lineCounter}, original line is ${originalLine}`
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
              console.log(`No issues found for ${filePath} chunk : ${chunk}`);
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
            console.log(`No issues found for ${filePath} chunk : ${chunk}`);
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
    await fs.writeFile('feedbacks.json', JSON.stringify(feedbacks, null, 2), 'utf8');
    console.log('Feedbacks written to feedbacks.json');
    process.exit(0);
  } catch (error) {
    console.error("Error generating feedback:", error);
    process.exit(1);
  }
}
generateFeedback();
*/
console.log("Generate Feedback script started");

const fs = require("fs");
const { execSync } = require("child_process");
const { OpenAI } = require("openai");
const cachePath = ".github/cache/cache.json";
const rulesPath = ".github/rules/rules.json";
const rulesData = fs.readFileSync(rulesPath, "utf8");
const rules = JSON.parse(rulesData);

const assistantInstruction = `You are an AI code reviewer. Your task is to evaluate the provided code changes against a set of given rules.
For each code snippet:
1. Review the code against **each rule** individually.
2. Report **every violation** you find in a separate JSON object.
3. If multiple rules are violated in the same code snippet, create separate JSON objects for each violation.
4. Include fixes for each issue in the JSON response, specific to the violation being addressed.
5. always look at the line before and after to understand if an issue is happening or not.
6.Always return valid JSON without any additional formatting or code block markers (e.g., no \`\`\`json).
### Rules for Review:
${JSON.stringify(rules)}
### Respond in This JSON Format:
[
  {
    "filePath": "<file_path>",
    "line": <line_number>,
    "issuesDescription": "<short_description_about_the_violation>",
    "fix": "<code_snippet_to_fix_the_violation>"
  }
]

### Key Instructions:
- Process each rule individually and systematically.
- For each violation, create a separate JSON object.
- If multiple rules are violated in the same snippet, include one object per rule.
- Ensure the JSON is valid and properly escaped.
- If no violations are found, respond with: { "status": "pass" }.
`;
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MAX_TOKENS = 8000;
const AVERAGE_LINE_CHARACTERS = 80;
const CHARACTERS_PER_TOKEN = 4;
const RESERVED_TOKENS = 1000;
async function loadCache() {
  const cacheData = await fs.promises.readFile(cachePath, "utf8");
  console.log("Loaded cache:", cacheData);
  return JSON.parse(cacheData);
}

async function saveCache(cache) {
  await fs.promises.writeFile(cachePath, JSON.stringify(cache, null, 2), "utf8");
  console.log("saving cache...");
  console.log(`cache after: ${JSON.stringify(cache)}`);
  const loadedCache = await loadCache();
  console.log("loaded cache after : ", loadedCache);
}

function sanitizeJsonString(rawString) {
  try {
    // Return an empty string if rawString is undefined, null, or not a string
    if (typeof rawString !== "string") {
      console.warn(
        "sanitizeJsonString: Received non-string input. Skipping sanitization."
      );
      return "";
    }
    // Regex to match any code block, e.g., ```json, ```, or other formats
    const codeBlockRegex = /^```(?:\w+)?\s*([\s\S]*?)\s*```$/;

    const match = rawString.match(codeBlockRegex);
    if (match) {
      // Extract the JSON content inside the code block
      return match[1].trim();
    }

    // If no code block markers are found, assume it's plain JSON
    return rawString.trim();
  } catch (error) {
    console.error("sanitizeJsonString: Error sanitizing JSON string:", error);
    return "";
  }
}

async function generateFeedback() {
  try {
    // Load rules and diff
    const diff = await fs.promises.readFile("pr_diff.txt", "utf8");
    // Determine current PR ID
    const prId = process.env.PR_NUMBER;
    console.log(`Processing PR: ${prId}`);
    
    const cache = await loadCache();
    console.log("Loaded cache:", cache);
    // Initialize or retrieve assistant and thread
    if (!cache[prId]) {
      cache[prId] = { assistantId: null, threadId: null, reviewedCommits: [] };
    }

    let assistantId = cache[prId]?.assistantId;
    let threadId = cache[prId]?.threadId;
    if(!assistantId) {
    // Step 1: Create an Assistant for this PR
    const assistant = await openai.beta.assistants.create({
      name: `PR Review Assistant`,
      instructions: assistantInstruction,
      tools: [{ type: "code_interpreter" }],
      model: "gpt-4o",
      temperature: 0.5,
      top_p: 1,
    });
    assistantId = assistant.id;
    console.log(`Assistant created: ${assistantId}`);
    cache[prId].assistantId = assistantId;
    } else {
      console.log(`Reusing existing Assistant: ${assistantId}`);
    }

    if(!threadId) { 
          // Step 2: Create a Thread for this PR
    const thread = await openai.beta.threads.create();
    threadId = thread.id;
    console.log(`Thread created: ${threadId}`);
    cache[prId].threadId = threadId;
    } else {
      console.log(`Reusing existing Thread: ${threadId}`);
    }
    // Step 3: Process changes and create Messages
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
          return null; // Skip invalid files
        }

        const header = lines.find((line) => line.startsWith("@@"));
        const position = header
          ? parseInt(header.match(/\+([0-9]+)/)?.[1], 10)
          : null;

        const addedLines = [];
        let lineCounter = position || 0;

        for (const line of lines) {
          if (line.startsWith("+") && !line.startsWith("+++")) {
            addedLines.push({
              lineNumber: lineCounter,
              lineDiff: line.slice(1),
            });
            lineCounter++;
          }
        }

        return addedLines.length ? { filePath, addedLines } : null;
      })
      .filter(Boolean);
      if(changes.length === 0) { 
        console.log('No changes found. Exiting...');
        process.exit(0);
      }

    // Step 4: Add Messages for each chunk
    let chunkIndex = 1;
    let lastMessage;
    for (const { filePath, addedLines } of changes) {
      let chunk = [];
      let currentTokenCount = 0;

      for (const line of addedLines) {
        const lineTokenEstimate = Math.ceil(
          (line.lineDiff.length || AVERAGE_LINE_CHARACTERS) /
            CHARACTERS_PER_TOKEN
        );

        if (
          currentTokenCount + lineTokenEstimate >
          MAX_TOKENS - RESERVED_TOKENS
        ) {
          console.log(`Adding chunk ${chunkIndex} for file ${filePath}...`);
          lastMessage = await openai.beta.threads.messages.create(threadId, {
            role: "user",
            content: `Review the following changes in the filePath ${filePath}:\n${JSON.stringify(
              chunk,
              null,
              2
            )}`,
          });
          console.log(`user message created: ${lastMessage.id}`);
          chunk = [];
          currentTokenCount = 0;
          chunkIndex++;
        }

        chunk.push(line);
        currentTokenCount += lineTokenEstimate;
      }
      if (chunk.length > 0) {
        console.log(`Adding final chunk ${chunkIndex} for file ${filePath}...`);
        lastMessage = await openai.beta.threads.messages.create(threadId, {
          role: "user",
          content: `Review the following changes in the filePath ${filePath}:\n${JSON.stringify(
            chunk,
            null,
            2
          )}`,
        });
        console.log(`user message created: ${lastMessage.id}`);
      }
    }
    if (!lastMessage) {
      console.error("No messages were created. Exiting...");
      process.exit(1);
    }
    const lastMessageIdBeforeRun = lastMessage.id;
    // Step 5: Create a Run
    console.log(`Creating run for thread ${threadId}...`);
    const run = await openai.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: assistant.id,
    });

    if (!run || run.status !== "completed") {
      console.error(`Run failed with status: ${run.status}`);
      process.exit(1);
    }
    // Step 6: Retrieve and save feedback
    const assistantMessages = await openai.beta.threads.messages.list(
      threadId,
      {
        order: "desc", // Ensure messages are retrieved in chronological order
        before: lastMessageIdBeforeRun, // Only retrieve messages after the last user message
        limit: 1, // Limit to the last message
      }
    );

    // Sanitize and parse each assistant message
    const feedbacks = assistantMessages.data
      .filter((message) => message.role === "assistant")
      .flatMap((message) => {
        try {
          // Sanitize and parse each message content
          const sanitizedMessage = sanitizeJsonString(
            message.content[0].text.value
          );
          return JSON.parse(sanitizedMessage); // Parse into JSON object
        } catch (error) {
          console.error(
            "Error parsing assistant message content:",
            error.message
          );
          return null; // Skip invalid messages
        }
      })
      .filter(Boolean); // Remove null values

    // Map feedbacks to update with original line numbers
    const updatedFeedbacks = feedbacks.map((feedback) => {
      try {
        const blameOutput = execSync(
          `git blame -L ${feedback.line},${feedback.line} --line-porcelain HEAD -- ${feedback.filePath}`
        )
          .toString()
          .trim();
        const commitHash = blameOutput.split("\n")[0].split(" ")[0];
        const originalLineMatch = blameOutput.split("\n")[0].split(" ")[1];

        const originalLine = originalLineMatch
          ? parseInt(originalLineMatch, 10)
          : feedback.line;

        console.log(`line : ${feedback.line} mapped to the original line ${originalLine}`);
        return { ...feedback, line: originalLine, commitId: commitHash }; // Update with line and commit hash
      } catch (error) {
        console.error(
          `Failed to get original line number for ${feedback.filePath}:${feedback.line}`,
          error.message
        );
        return feedback; // Return unchanged feedback on error
      }
    });

    await fs.promises.writeFile(
      "feedbacks.json",
      JSON.stringify(updatedFeedbacks, null, 2),
      "utf8"
    );
    console.log("Feedbacks written to feedbacks.json: ", updatedFeedbacks);
    await saveCache(cache);
  } catch (error) {
    console.error("Error generating feedback:", error);
    process.exit(1);
  }
}

generateFeedback();
