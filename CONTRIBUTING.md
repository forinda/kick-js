# Contributing to KickJS

🎉 Thank you for your interest in contributing to KickJS! We welcome contributions from developers of all skill levels and backgrounds.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Documentation](#documentation)
- [Pull Request Process](#pull-request-process)
- [Issue Reporting](#issue-reporting)
- [Feature Requests](#feature-requests)
- [Release Process](#release-process)
- [Community](#community)

## 🤝 Code of Conduct

We are committed to providing a welcoming and inclusive environment for everyone. By participating in this project, you agree to abide by our Code of Conduct:

### Our Standards

**Positive behavior includes:**
- Using welcoming and inclusive language
- Being respectful of differing viewpoints and experiences
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

**Unacceptable behavior includes:**
- The use of sexualized language or imagery
- Trolling, insulting/derogatory comments, and personal or political attacks
- Public or private harassment
- Publishing others' private information without explicit permission
- Other conduct which could reasonably be considered inappropriate in a professional setting

### Enforcement

Instances of abusive, harassing, or otherwise unacceptable behavior may be reported to the project maintainers at [conduct@kickjs.dev](mailto:conduct@kickjs.dev). All complaints will be reviewed and investigated promptly and fairly.

## 🚀 Getting Started

### Prerequisites

Before contributing, ensure you have:

- **Node.js** (version 18 or higher)
- **pnpm** (preferred package manager)
- **Git** for version control
- **TypeScript** knowledge
- **Express.js** familiarity

### Quick Start

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/yourusername/kickjs.git
   cd kickjs
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/forinda/kickjs.git
   ```
4. **Install dependencies**:
   ```bash
   pnpm install
   ```
5. **Run tests** to ensure everything works:
   ```bash
   pnpm test
   ```

## 💻 Development Setup

### Environment Setup

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Build the project**:
   ```bash
   pnpm build
   ```

3. **Run development server**:
   ```bash
   pnpm dev
   ```

4. **Run tests**:
   ```bash
   pnpm test
   pnpm test:watch  # Watch mode
   pnpm test:coverage  # With coverage
   ```

### Development Scripts

```bash
# Development
pnpm dev                 # Start development server with hot reload
pnpm dev:examples        # Run example applications

# Building
pnpm build              # Build the library
pnpm build:watch        # Build in watch mode

# Testing
pnpm test               # Run all tests
pnpm test:watch         # Run tests in watch mode
pnpm test:coverage      # Run tests with coverage report
pnpm test:e2e           # Run end-to-end tests

# Code Quality
pnpm lint               # Run ESLint
pnpm lint:fix           # Fix ESLint issues
pnpm type-check         # Run TypeScript type checking
pnpm format             # Format code with Prettier

# Examples
pnpm example:basic-todo     # Run basic todo example
pnpm example:medium-kanban  # Run kanban example
pnpm example:complex-analytics # Run analytics example
```

## 📁 Project Structure

Understanding the project structure will help you navigate and contribute effectively:

```
kickjs/
├── src/                          # Source code
│   ├── core/                     # Core framework code
│   │   ├── app/                  # Application management
│   │   ├── decorators/           # Framework decorators
│   │   ├── types/                # TypeScript type definitions
│   │   ├── utils/                # Utility functions
│   │   └── constants/            # Constants and keys
│   ├── cli/                      # CLI tooling
│   └── index.ts                  # Main export file
├── examples/                     # Example applications
│   ├── basic-todo/               # Simple CRUD example
│   ├── medium-kanban/            # Kanban board example
│   └── complex-analytics/        # Analytics dashboard example
├── tests/                        # Test files
├── docs/                         # Documentation
├── dist/                         # Built files (generated)
└── README.md                     # Main documentation
```

### Key Directories

- **`src/core/`**: Contains the main framework logic
- **`src/core/decorators/`**: All framework decorators (`@KickController`, `@KickMiddleware`, etc.)
- **`src/core/types/`**: TypeScript interfaces and types
- **`src/core/utils/`**: Utility functions and helpers
- **`examples/`**: Working example applications demonstrating framework features

## 🔄 Development Workflow

### Branch Strategy

We follow a **feature branch workflow**:

1. **Main branches**:
   - `main`: Stable, production-ready code
   - `dev`: Development branch with latest features

2. **Feature branches**:
   - `feature/feature-name`: New features
   - `fix/bug-description`: Bug fixes
   - `docs/documentation-update`: Documentation updates
   - `refactor/improvement-description`: Code refactoring

### Workflow Steps

1. **Create a feature branch**:
   ```bash
   git checkout dev
   git pull upstream dev
   git checkout -b feature/amazing-feature
   ```

2. **Make your changes**:
   - Write code following our standards
   - Add tests for new functionality
   - Update documentation as needed

3. **Test your changes**:
   ```bash
   pnpm test
   pnpm build
   pnpm lint
   ```

4. **Commit your changes**:
   ```bash
   git add .
   git commit -m "feat: add amazing new feature"
   ```

5. **Push and create PR**:
   ```bash
   git push origin feature/amazing-feature
   ```

## 📝 Coding Standards

### TypeScript Guidelines

1. **Use strict TypeScript**:
   ```typescript
   // ✅ Good
   interface User {
     id: string;
     name: string;
     email: string;
   }
   
   // ❌ Avoid
   interface User {
     id: any;
     name: any;
     email: any;
   }
   ```

2. **Prefer explicit types**:
   ```typescript
   // ✅ Good
   function createUser(data: CreateUserDto): Promise<User> {
     // implementation
   }
   
   // ❌ Avoid
   function createUser(data: any): any {
     // implementation
   }
   ```

3. **Use meaningful names**:
   ```typescript
   // ✅ Good
   const userRepository = new UserRepository();
   const isEmailValid = validateEmail(email);
   
   // ❌ Avoid
   const repo = new UserRepository();
   const valid = validateEmail(email);
   ```

### Decorator Guidelines

1. **Follow naming conventions**:
   ```typescript
   // ✅ Framework decorators
   @KickController("/users")
   @KickMiddleware({ name: "Auth" })
   @KickInjectable()
   
   // ✅ Route decorators
   @KickGet("/")
   @KickPost("/")
   ```

2. **Provide comprehensive options**:
   ```typescript
   // ✅ Good - comprehensive options
   @KickMiddleware({
     name: "AuthMiddleware",
     priority: 1,
     global: false,
     tags: ["auth", "security"]
   })
   
   // ❌ Avoid - minimal options
   @KickMiddleware()
   ```

### Code Style

1. **Use consistent formatting**:
   - 2 spaces for indentation
   - Single quotes for strings
   - Trailing commas in objects/arrays
   - Semicolons at statement ends

2. **Follow ESLint rules**:
   ```bash
   pnpm lint        # Check for issues
   pnpm lint:fix    # Auto-fix issues
   ```

3. **Use meaningful comments**:
   ```typescript
   /**
    * Creates a new user with the provided data
    * @param userData - The user data to create
    * @returns Promise resolving to the created user
    */
   async createUser(userData: CreateUserDto): Promise<User> {
     // Validate email format before creation
     if (!this.isValidEmail(userData.email)) {
       throw new ValidationError('Invalid email format');
     }
     
     return this.userRepository.create(userData);
   }
   ```

## 🧪 Testing Guidelines

### Test Structure

We use **Vitest** for testing with the following structure:

```
tests/
├── unit/                 # Unit tests
├── integration/          # Integration tests
├── e2e/                  # End-to-end tests
└── fixtures/             # Test fixtures and mocks
```

### Writing Tests

1. **Unit Tests** - Test individual functions/classes:
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { UserService } from '../src/services/user.service';
   
   describe('UserService', () => {
     it('should create a user successfully', async () => {
       const userService = new UserService();
       const userData = { name: 'John', email: 'john@example.com' };
       
       const user = await userService.create(userData);
       
       expect(user).toBeDefined();
       expect(user.name).toBe('John');
       expect(user.email).toBe('john@example.com');
     });
   });
   ```

2. **Integration Tests** - Test feature combinations:
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { createKickApp } from '../src';
   import { TestModule } from './fixtures/test.module';
   
   describe('KickApp Integration', () => {
     it('should register controllers and middlewares', () => {
       const server = createKickApp({
         name: 'TestApp',
         modules: [TestModule]
       });
       
       const stats = server.getStats();
       expect(stats.controllersCount).toBeGreaterThan(0);
       expect(stats.middlewaresCount).toBeGreaterThan(0);
     });
   });
   ```

3. **Test Naming Conventions**:
   - Use descriptive test names
   - Follow "should [expected behavior] when [condition]" pattern
   - Group related tests with `describe` blocks

### Test Coverage

- Aim for **80%+ code coverage**
- All new features must include tests
- Bug fixes should include regression tests
- Run coverage with: `pnpm test:coverage`

## 📚 Documentation

### Code Documentation

1. **JSDoc Comments**:
   ```typescript
   /**
    * Decorator to define a controller class with automatic route registration
    * @param path - Base path for all routes in this controller
    * @returns Class decorator function
    * @example
    * ```typescript
    * @KickController('/users')
    * export class UserController {
    *   // controller methods
    * }
    * ```
    */
   export function KickController(path: string): ClassDecorator {
     // implementation
   }
   ```

2. **README Updates**:
   - Update examples when adding new features
   - Keep API documentation current
   - Include migration guides for breaking changes

3. **Inline Comments**:
   ```typescript
   // Extract middlewares from DI container after module loading
   this.extractMiddlewaresFromContainer();
   
   // Sort middleware by priority (lower numbers execute first)
   const sortedMiddleware = middleware.sort((a, b) => {
     const priorityA = getMiddlewarePriority(a);
     const priorityB = getMiddlewarePriority(b);
     return priorityA - priorityB;
   });
   ```

## 🔀 Pull Request Process

### Before Submitting

1. **Ensure your branch is up to date**:
   ```bash
   git checkout dev
   git pull upstream dev
   git checkout feature/your-feature
   git rebase dev
   ```

2. **Run all checks**:
   ```bash
   pnpm test
   pnpm lint
   pnpm type-check
   pnpm build
   ```

3. **Test examples**:
   ```bash
   pnpm example:basic-todo
   pnpm example:medium-kanban
   ```

### PR Template

Use this template for your pull requests:

```markdown
## Description
Brief description of changes and motivation.

## Type of Change
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature causing existing functionality to change)
- [ ] Documentation update

## Testing
- [ ] Tests pass locally
- [ ] Added tests for new functionality
- [ ] Updated existing tests if needed

## Documentation
- [ ] Updated README if needed
- [ ] Updated inline documentation
- [ ] Added JSDoc comments for new functions

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review of code completed
- [ ] Comments added for complex logic
- [ ] No new warnings or errors introduced
```

### Review Process

1. **Automated Checks**: All PRs run automated tests and linting
2. **Code Review**: At least one maintainer reviews all PRs
3. **Testing**: Reviewers test functionality manually if needed
4. **Approval**: PRs need approval before merging
5. **Merge**: Maintainers handle merging to preserve commit history

## 🐛 Issue Reporting

### Before Creating an Issue

1. **Search existing issues** to avoid duplicates
2. **Check latest version** - issue might be fixed
3. **Review documentation** - might be usage issue

### Bug Report Template

```markdown
**Bug Description**
Clear description of the bug.

**Steps to Reproduce**
1. Step one
2. Step two
3. See error

**Expected Behavior**
What you expected to happen.

**Actual Behavior**
What actually happened.

**Environment**
- OS: [e.g., macOS 12.0]
- Node.js: [e.g., 18.17.0]
- KickJS: [e.g., 1.0.0]
- TypeScript: [e.g., 5.0.0]

**Additional Context**
Any other relevant information.

**Code Example**
```typescript
// Minimal reproduction code
```

### Issue Labels

We use labels to categorize issues:

- `bug`: Something isn't working
- `enhancement`: New feature or request
- `documentation`: Documentation improvements
- `good first issue`: Good for newcomers
- `help wanted`: Extra attention needed
- `priority:high`: Critical issues
- `priority:medium`: Important issues
- `priority:low`: Nice to have

## 💡 Feature Requests

### Proposing Features

1. **Check existing issues** for similar requests
2. **Consider scope**: Does it fit KickJS goals?
3. **Provide use cases**: Real-world scenarios
4. **Consider alternatives**: Other solutions you've tried

### Feature Request Template

```markdown
**Feature Description**
Clear description of the proposed feature.

**Problem Statement**
What problem does this solve?

**Proposed Solution**
How should this feature work?

**Use Cases**
Real-world scenarios where this would be useful.

**Alternative Solutions**
Other approaches you've considered.

**Additional Context**
Any other relevant information.

**API Design** (if applicable)
```typescript
// Proposed API usage
```

## 🚀 Release Process

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0): Breaking changes
- **MINOR** (0.1.0): New features (backward compatible)
- **PATCH** (0.0.1): Bug fixes (backward compatible)

### Release Steps

1. **Update version** in `package.json`
2. **Update CHANGELOG.md** with new features/fixes
3. **Create release PR** targeting `main`
4. **Tag release** after merging
5. **Publish to npm** (automated via CI)

### Commit Message Format

We use [Conventional Commits](https://conventionalcommits.org/):

```bash
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New features
- `fix`: Bug fixes
- `docs`: Documentation changes
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance tasks
- `perf`: Performance improvements
- `ci`: CI/CD changes

**Examples:**
```bash
feat(decorators): add @KickMiddleware decorator with priority support
fix(routing): resolve route prefix concatenation issue
docs(readme): update installation instructions
refactor(utils): extract route mapping to separate utility class
test(middleware): add integration tests for middleware system
```

## 🌟 Community

### Communication Channels

- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: General questions and community chat
- **Discord** (coming soon): Real-time community support
- **Twitter**: [@KickJSFramework](https://twitter.com/KickJSFramework) - Updates and announcements

### Getting Help

1. **Documentation**: Check README and code comments
2. **Examples**: Look at example applications
3. **Issues**: Search existing GitHub issues
4. **Discussions**: Ask questions in GitHub Discussions
5. **Community**: Join our Discord for real-time help

### Contributing to Community

- **Answer questions** in GitHub Discussions
- **Help review PRs** from other contributors  
- **Improve documentation** and examples
- **Share your KickJS projects** with the community
- **Write blog posts** or tutorials about KickJS

### Recognition

We value all contributions and recognize contributors through:

- **Contributors list** in README
- **Release notes** mentioning significant contributions
- **Special badges** for consistent contributors
- **Community highlights** for exceptional contributions

## 🙏 Thank You

Thank you for contributing to KickJS! Your efforts help make this framework better for everyone. Every contribution, no matter how small, is valuable and appreciated.

**Happy coding!** 🚀

---

*For questions about this contribution guide, please [open an issue](https://github.com/forinda/kickjs/issues) or reach out to the maintainers.*