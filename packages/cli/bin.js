#!/usr/bin/env node

// CJS wrapper for the ESM CLI entry.
// Bin entries must be plain .js (not .mjs) for universal Node.js compatibility.
import("./dist/cli.mjs");
