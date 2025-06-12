# Aidan Slack Bot

A TypeScript Slack bot powered by the Bolt SDK that integrates with **Ollama** or **Docker Model Runner** for AI-powered conversations. The bot responds to mentions and direct messages, providing intelligent responses using your local LLM installation.

## Features

- 🤖 **AI-Powered Responses**: Uses Ollama or Docker Model Runner for intelligent conversation
- 🏷️ **Mention Detection**: Responds when tagged with `@aidan` in channels
- 💬 **Direct Messages**: Supports private conversations
- 🔧 **Configurable**: Environment-based configuration for easy deployment
- 📱 **Socket Mode**: No need for public endpoints during development
- 🛡️ **Error Handling**: Graceful error handling with user-friendly messages
- 🏠 **Home Tab**: Custom home tab with bot information and instructions
- 🚀 **Multiple Providers**: Support for both Ollama and Docker Model Runner APIs
- 👤 **Personalized Responses**: Fetches and uses user display names for context-aware interactions
- 🧠 **Memory System**: Provides semantic search and context enhancement using vector-based storage for better conversation history

## Prerequisites

- **Node.js**: Version 18 or higher
- **LLM Provider**: Either:
  - **Ollama**: Running locally or accessible via network ([Install Ollama](https://ollama.ai/))
  - **Docker Model Runner**: Enabled in Docker Desktop ([Docker Model Runner docs](https://docs.docker.com/ai/model-runner/))
- **Slack App**: Configured with proper permissions and tokens

## Setup

### 1. Install Ollama

First, install and set up Ollama:

```bash
# Install Ollama (visit https://ollama.ai/ for installation instructions)
# Pull a model (e.g., llama2)
ollama pull llama2
```

### 2. Create a Slack App

1. Go to [Slack API Dashboard](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Name your app (e.g., "Aidan Bot") and select your workspace
4. Configure the following permissions under **OAuth & Permissions**:

   **Bot Token Scopes:**
   - `app_mentions:read` - View messages that directly mention your bot
   - `chat:write` - Send messages as the bot
   - `im:history` - View messages in direct messages
   - `im:read` - View basic information about direct messages
   - `im:write` - Start direct messages with people
   - `users:read` - Access user profile information for personalized responses

5. **Enable Socket Mode:**
   - Go to **Socket Mode** and toggle it on
   - Generate an App-Level Token with `connections:write` scope

6. **Enable Events:**
   - Go to **Event Subscriptions** and toggle on
   - Subscribe to these bot events:
     - `app_mention` - When someone mentions your bot
     - `message.im` - Messages in direct message channels
     - `app_home_opened` - When user opens bot's home tab

7. **Install App to Workspace:**
   - Go to **Install App** and install to your workspace
   - Copy the Bot User OAuth Token

### 3. Clone and Install

```bash
git clone <your-repo-url>
cd aidan-slack-bot
npm install
```

### 4. Configure Environment

Create a `.env` file in the project root:

```env
# Slack Bot Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
SLACK_APP_TOKEN=xapp-your-app-token-here

# LLM Provider Configuration
LLM_PROVIDER=ollama  # or "docker-model-runner"

# LLM Service Configuration
LLM_BASE_URL=http://localhost:11434  # Default for Ollama
LLM_MODEL=llama2  # or "ai/smollm2" for Docker Model Runner
LLM_TIMEOUT=60000

# Memory System Configuration
EMBEDDINGS_PROVIDER=ollama  # Can be different from LLM_PROVIDER
EMBEDDINGS_BASE_URL=http://localhost:11434  # Defaults to LLM_BASE_URL if not set
EMBEDDINGS_MODEL=nomic-embed-text  # For Ollama
DATABASE_PATH=./data/memory.sqlite
MAX_MEMORY_RESULTS=5
SIMILARITY_THRESHOLD=0.7  # 0.0-1.0, higher = more strict

# Bot Configuration
BOT_NAME=Aidan
PORT=3000

# System Prompt for LLM
SYSTEM_PROMPT="You are Aidan, a helpful and friendly AI assistant integrated into Slack..."
```

#### Provider-Specific Examples:

**For Ollama:**
```env
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=llama2  # or qwen2.5:7b, etc.
```

**For Docker Model Runner:**
```env
LLM_PROVIDER=docker-model-runner
LLM_BASE_URL=http://localhost:12434
LLM_MODEL=ai/smollm2  # or ai/phi3, etc.
```

### 5. Build and Run

```bash
# Build the TypeScript code
npm run build

# Start the bot
npm start

# Or run in development mode with auto-reload
npm run dev
```

## Usage

### Mentioning the Bot

In any channel where the bot is present, mention it to get a response:

```
@aidan What is the weather like today?
@aidan Can you help me with a coding problem?
@aidan Tell me a joke
```

### Direct Messages

Send a direct message to the bot for private conversations:

```
Hello Aidan, can you help me understand TypeScript?
```

### Home Tab

Click on the bot's profile and go to the "Home" tab to see:
- Welcome message and instructions
- Current model information
- Bot status

## Configuration Options

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token (xoxb-...) | - | ✅ |
| `SLACK_SIGNING_SECRET` | Signing Secret for request verification | - | ✅ |
| `SLACK_APP_TOKEN` | App-Level Token for Socket Mode (xapp-...) | - | ✅ |
| `LLM_PROVIDER` | Provider: `ollama` or `docker-model-runner` | `ollama` | ❌ |
| `LLM_BASE_URL` | Base URL for LLM API | Auto-detected based on provider | ❌ |
| `LLM_MODEL` | Model name to use | Provider-specific default | ❌ |
| `LLM_TIMEOUT` | Request timeout in milliseconds | `60000` | ❌ |
| `BOT_NAME` | Bot name for mentions | `Aidan` | ❌ |
| `PORT` | Port for the application | `3000` | ❌ |
| `SYSTEM_PROMPT` | System prompt for LLM personality | Default helpful assistant | ❌ |

## Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run the compiled bot
- `npm run dev` - Run in development mode with auto-reload
- `npm run lint` - Run ESLint for code quality
- `npm run type-check` - Run TypeScript type checking

## Error Handling

The bot includes comprehensive error handling:

- **Connection Issues**: When Ollama is unreachable
- **Model Issues**: When the specified model isn't available
- **Timeout Issues**: When requests take too long
- **Slack API Issues**: When Slack API calls fail

Users receive friendly error messages rather than technical details.

## Development

### Project Structure

```
src/
├── app.ts              # Main application entry point
├── config/
│   └── index.ts        # Configuration loader and validation
├── services/
│   └── ollama.ts       # Ollama API service
└── types/
    └── index.ts        # TypeScript type definitions
```

### Adding New Features

1. **New Commands**: Add message handlers in `setupEventHandlers()`
2. **New Services**: Create service classes in `services/`
3. **Configuration**: Add new environment variables to `config/index.ts`
4. **Types**: Define new TypeScript interfaces in `types/index.ts`

## Troubleshooting

### Bot Not Responding

1. Check that Ollama is running: `ollama list`
2. Verify bot tokens are correct in `.env`
3. Ensure bot has proper permissions in Slack
4. Check bot logs for error messages

### Ollama Connection Issues

1. Verify Ollama is running: `curl http://localhost:11434/api/tags`
2. Check if the model is installed: `ollama list`
3. Verify `OLLAMA_BASE_URL` in `.env`

### Slack Permission Issues

1. Verify bot token starts with `xoxb-`
2. Check app token starts with `xapp-`
3. Ensure Socket Mode is enabled
4. Verify bot has required OAuth scopes

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and add tests
4. Run linting: `npm run lint`
5. Commit your changes: `git commit -am 'Add feature'`
6. Push to the branch: `git push origin feature-name`
7. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

If you encounter issues:

1. Check the troubleshooting section
2. Review the logs for error messages
3. Ensure all prerequisites are met
4. Open an issue with detailed information about the problem 