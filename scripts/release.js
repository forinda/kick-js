#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');

const RELEASE_TYPES = ['patch', 'minor', 'major', 'prerelease'];

function runCommand(command, description) {
  console.log(`\n🔄 ${description}...`);
  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`✅ ${description} completed`);
  } catch (error) {
    console.error(`❌ ${description} failed:`, error.message);
    process.exit(1);
  }
}

function getCurrentVersion() {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  return packageJson.version;
}

function getNextVersion(releaseType) {
  const current = getCurrentVersion();
  const [major, minor, patch] = current.split('.').map(Number);
  
  switch (releaseType) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'prerelease':
      return `${major}.${minor}.${patch + 1}-beta.0`;
    default:
      throw new Error(`Unknown release type: ${releaseType}`);
  }
}

function checkGitStatus() {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (status.trim()) {
      console.error('❌ Working directory is not clean. Please commit or stash changes.');
      process.exit(1);
    }
  } catch {
    console.error('❌ Failed to check git status');
    process.exit(1);
  }
}

function checkBranch() {
  try {
    const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    if (branch !== 'main' && branch !== 'master') {
      console.warn(`⚠️  You are on branch '${branch}'. Consider releasing from 'main' or 'master'.`);
      // Don't exit, just warn
    }
  } catch {
    console.warn('⚠️  Could not determine current branch');
  }
}

function getLastTag() {
  try {
    return execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
  } catch {
    // If no tags exist, use initial commit
    try {
      return execSync('git rev-list --max-parents=0 HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'HEAD~10'; // Fallback
    }
  }
}

function generateReleaseNotes(version) {
  console.log('\n📝 Generating release notes...');
  
  const lastTag = getLastTag();
  console.log(`📅 Changes since ${lastTag}:`);
  
  try {
    // Get commits since last tag
    const commits = execSync(`git log ${lastTag}..HEAD --oneline --no-merges`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(line => line.length > 0);

    if (commits.length === 0) {
      console.log('   No new commits found');
      return '';
    }

    // Categorize commits
    const features = [];
    const fixes = [];
    const chores = [];
    const breaking = [];
    const docs = [];

    commits.forEach(commit => {
      const message = commit.substring(8); // Remove hash
      const lowerMessage = message.toLowerCase();
      
      if (lowerMessage.includes('breaking') || lowerMessage.includes('!:')) {
        breaking.push(message);
      } else if (lowerMessage.startsWith('feat') || lowerMessage.includes('feature')) {
        features.push(message);
      } else if (lowerMessage.startsWith('fix') || lowerMessage.includes('bug')) {
        fixes.push(message);
      } else if (lowerMessage.startsWith('docs') || lowerMessage.includes('documentation')) {
        docs.push(message);
      } else if (lowerMessage.startsWith('chore') || lowerMessage.startsWith('refactor') || lowerMessage.startsWith('style')) {
        chores.push(message);
      } else {
        // Default to chores if no clear category
        chores.push(message);
      }
    });

    // Generate release notes content
    let releaseNotes = `# Release v${version}\n\n`;
    
    if (breaking.length > 0) {
      releaseNotes += '## 🚨 Breaking Changes\n\n';
      breaking.forEach(item => releaseNotes += `- ${item}\n`);
      releaseNotes += '\n';
    }
    
    if (features.length > 0) {
      releaseNotes += '## ✨ New Features\n\n';
      features.forEach(item => releaseNotes += `- ${item}\n`);
      releaseNotes += '\n';
    }
    
    if (fixes.length > 0) {
      releaseNotes += '## 🐛 Bug Fixes\n\n';
      fixes.forEach(item => releaseNotes += `- ${item}\n`);
      releaseNotes += '\n';
    }
    
    if (docs.length > 0) {
      releaseNotes += '## 📚 Documentation\n\n';
      docs.forEach(item => releaseNotes += `- ${item}\n`);
      releaseNotes += '\n';
    }
    
    if (chores.length > 0) {
      releaseNotes += '## 🔧 Maintenance\n\n';
      chores.forEach(item => releaseNotes += `- ${item}\n`);
      releaseNotes += '\n';
    }

    // Add metadata
    releaseNotes += '---\n\n';
    releaseNotes += `**Full Changelog**: https://github.com/forinda/kick-js/compare/${lastTag}...v${version}\n`;
    releaseNotes += `**NPM Package**: https://www.npmjs.com/package/@forinda/kickjs/v/${version}\n`;

    // Save to file
    const releaseNotesFile = `RELEASE_NOTES_v${version}.md`;
    fs.writeFileSync(releaseNotesFile, releaseNotes);
    
    console.log(`✅ Release notes generated: ${releaseNotesFile}`);
    console.log('\n📋 Release Notes Preview:');
    console.log('═'.repeat(50));
    console.log(releaseNotes);
    console.log('═'.repeat(50));
    
    return releaseNotesFile;
  } catch (error) {
    console.warn('⚠️  Could not generate automatic release notes:', error.message);
    return '';
  }
}

function main() {
  const args = process.argv.slice(2);
  const releaseType = args[0];
  const dryRun = args.includes('--dry-run');

  if (!releaseType || !RELEASE_TYPES.includes(releaseType)) {
    console.log('🚀 KickJS Release Script');
    console.log('\nUsage: node scripts/release.js <release-type> [options]');
    console.log('\nRelease types:');
    console.log('  patch     - Bug fixes (0.1.4 → 0.1.5)');
    console.log('  minor     - New features (0.1.4 → 0.2.0)');
    console.log('  major     - Breaking changes (0.1.4 → 1.0.0)');
    console.log('  prerelease - Pre-release (0.1.4 → 0.1.5-beta.0)');
    console.log('\nOptions:');
    console.log('  --dry-run      Show what would be done without executing');
    console.log('\nNote:');
    console.log('  • Automatic release notes generated from git commits');
    console.log('  • Release notes categorized by commit type (feat, fix, docs, etc.)');
    console.log('  • No external dependencies required');
  console.log('\nExamples:');
  console.log('  node scripts/release.js patch');
  console.log('  node scripts/release.js minor');
  console.log('  node scripts/release.js major --dry-run');
  console.log('\nOr using npm scripts:');
  console.log('  npm run release:patch');
  console.log('  npm run release:minor');
  console.log('  npm run release:major');
    process.exit(1);
  }

  const currentVersion = getCurrentVersion();
  const nextVersion = getNextVersion(releaseType);

  console.log('🚀 KickJS Release Script');
  console.log('═'.repeat(50));
  console.log(`📦 Package: @forinda/kickjs`);
  console.log(`📈 Release Type: ${releaseType}`);
  console.log(`🏷️  Current Version: ${currentVersion}`);
  console.log(`🎯 Next Version: ${nextVersion}`);
  console.log(`🧪 Dry Run: ${dryRun ? 'Yes' : 'No'}`);
  console.log('═'.repeat(50));

  if (dryRun) {
    console.log('\n🧪 DRY RUN - No changes will be made');
    console.log('\nCommands that would be executed:');
    console.log('1. Git status check');
    console.log('2. npm run clean');
    console.log('3. npm run build');
    console.log('4. npm run check');
    console.log('5. npm test');
    console.log(`6. npm version ${releaseType}`);
    console.log('7. git push --follow-tags');
    console.log('8. npm publish');
    console.log('9. Generate release notes from git commits');
    console.log('10. Manual GitHub release instructions provided');
    
    // Show what release notes would look like
    console.log('\n📋 Release notes preview:');
    generateReleaseNotes(nextVersion);
    return;
  }

  // Pre-flight checks
  console.log('\n🔍 Running pre-flight checks...');
  checkGitStatus();
  checkBranch();

  // Build and test
  runCommand('npm run clean', 'Cleaning build directory');
  runCommand('npm run build', 'Building project');
  runCommand('npm run check', 'Type checking');
  runCommand('npm test', 'Running tests');

  // Version bump
  runCommand(`npm version ${releaseType} --no-git-tag-version`, `Bumping version to ${nextVersion}`);
  
  // Commit version bump
  runCommand('git add package.json package-lock.json', 'Staging package.json and package-lock.json');
  runCommand(`git commit -m "chore: release v${nextVersion}"`, 'Committing version bump');
  
  // Create git tag
  runCommand(`git tag v${nextVersion}`, 'Creating git tag');

  // Push to repository
  runCommand('git push --follow-tags', 'Pushing to repository');

  // Publish to npm
  runCommand('npm publish', 'Publishing to npm');

  // Generate release notes
  const releaseNotesFile = generateReleaseNotes(nextVersion);

  console.log('\n🎉 Release completed successfully!');
  console.log(`📦 Published: @forinda/kickjs@${nextVersion}`);
  console.log(`🏷️  Tagged: v${nextVersion}`);
  console.log(`🔗 NPM: https://www.npmjs.com/package/@forinda/kickjs`);
  
  if (releaseNotesFile) {
    console.log(`📝 Release notes: ${releaseNotesFile}`);
  }
  
  console.log('\n📝 To create a GitHub release:');
  console.log(`   1. Go to: https://github.com/forinda/kick-js/releases/new`);
  console.log(`   2. Tag: v${nextVersion} (should be auto-detected)`);
  console.log(`   3. Title: v${nextVersion}`);
  if (releaseNotesFile) {
    console.log(`   4. Copy content from ${releaseNotesFile} into the description`);
    console.log(`   5. Publish the release`);
  } else {
    console.log(`   4. Click "Generate release notes" for automatic changelog`);
    console.log(`   5. Publish the release`);
  }
  console.log('\n🎯 Or use the quick link:');
  console.log(`   https://github.com/forinda/kick-js/releases/new?tag=v${nextVersion}&title=v${nextVersion}`);
  console.log('\n💡 Tip: Use `npm run release:patch` for easier releases!');
}

main();