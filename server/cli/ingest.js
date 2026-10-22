import { ingestLocalFile, IngestError, showJob } from "../src/ingest.js";

function flag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function printError(error) {
  if (error instanceof IngestError) {
    const body = { error: error.code, message: error.message };
    if (error.details.length) body.details = error.details;
    console.error(JSON.stringify(body, null, 2));
    return;
  }
  console.error(JSON.stringify({ error: "unexpected", message: "Ingest failed." }, null, 2));
}

const args = process.argv.slice(2);

try {
  if (args[0] === "--show") {
    const job = await showJob(args[1]);
    console.log(JSON.stringify(job, null, 2));
  } else {
    const file = args.find((arg, index) => {
      if (arg.startsWith("--")) return false;
      const previous = args[index - 1];
      return previous !== "--campaign" && previous !== "--channel";
    });
    if (!file) {
      console.error("Usage: node server/cli/ingest.js <file> [--campaign name] [--channel name]");
      console.error("       node server/cli/ingest.js --show <jobId>");
      process.exitCode = 1;
    } else {
      const result = await ingestLocalFile(file, {
        campaign: flag(args, "--campaign"),
        channel: flag(args, "--channel"),
      });
      console.log(
        JSON.stringify(
          {
            duplicate: result.duplicate,
            jobId: result.job.id,
            stage: result.job.stage,
            jobFile: `data/jobs/${result.job.id}.json`,
            providerCalls: result.job.usage.providerCalls,
          },
          null,
          2,
        ),
      );
    }
  }
} catch (error) {
  printError(error);
  process.exitCode = 1;
}
