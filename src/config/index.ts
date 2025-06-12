import { config as dotenvConfig } from 'dotenv';
import { Config, LLMProvider } from '../types';

// Load environment variables from .env file
dotenvConfig();

/**
 * Validates that a required environment variable exists
 * @param name - Name of the environment variable
 * @param value - Value of the environment variable
 * @returns The validated value
 * @throws Error if the value is missing
 */
function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Converts a string to a number with validation
 * @param name - Name of the environment variable
 * @param value - String value to convert
 * @param defaultValue - Default value if conversion fails
 * @returns The parsed number
 */
function parseNumber(name: string, value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }
  
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    console.warn(`Invalid number for ${name}, using default: ${defaultValue}`);
    return defaultValue;
  }
  
  return parsed;
}

/**
 * Converts a string to a float with validation
 * @param name - Name of the environment variable
 * @param value - String value to convert
 * @param defaultValue - Default value if conversion fails
 * @returns The parsed float
 */
function parseFloat(name: string, value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }
  
  const parsed = Number.parseFloat(value);
  if (isNaN(parsed)) {
    console.warn(`Invalid float for ${name}, using default: ${defaultValue}`);
    return defaultValue;
  }
  
  return parsed;
}

/**
 * Validates LLM provider type
 * @param value - The provider value from environment
 * @returns Valid LLMProvider
 */
function parseLLMProvider(value: string | undefined): LLMProvider {
  if (value === 'docker-model-runner') return 'docker-model-runner';
  return 'ollama'; // Default to ollama
}

/**
 * Gets default base URL based on provider
 * @param provider - The LLM provider
 * @returns Default base URL for the provider
 */
function getDefaultBaseUrl(provider: LLMProvider): string {
  switch (provider) {
    case 'docker-model-runner':
      return 'http://localhost:12434';
    case 'ollama':
    default:
      return 'http://localhost:11434';
  }
}

/**
 * Gets default model based on provider
 * @param provider - The LLM provider
 * @returns Default model for the provider
 */
function getDefaultModel(provider: LLMProvider): string {
  switch (provider) {
    case 'docker-model-runner':
      return 'ai/smollm2';
    case 'ollama':
    default:
      return 'llama2';
  }
}

/**
 * Gets default embeddings model based on provider
 * @param provider - The LLM provider
 * @returns Default embeddings model for the provider
 */
function getDefaultEmbeddingsModel(provider: LLMProvider): string {
  switch (provider) {
    case 'docker-model-runner':
      return 'ai/mxbai-embed-large:latest';
    case 'ollama':
    default:
      return 'nomic-embed-text';
  }
}

/**
 * Loads and validates configuration from environment variables
 * @returns Validated configuration object
 */
export function loadConfig(): Config {
  try {
    const provider = parseLLMProvider(process.env.LLM_PROVIDER);
    const defaultBaseUrl = getDefaultBaseUrl(provider);
    const defaultModel = getDefaultModel(provider);
    
    const embeddingsProvider = parseLLMProvider(process.env.EMBEDDINGS_PROVIDER || process.env.LLM_PROVIDER);
    const defaultEmbeddingsBaseUrl = getDefaultBaseUrl(embeddingsProvider);
    const defaultEmbeddingsModel = getDefaultEmbeddingsModel(embeddingsProvider);
    
    const config: Config = {
      // Slack configuration - all required
      slackBotToken: requireEnv('SLACK_BOT_TOKEN', process.env.SLACK_BOT_TOKEN),
      slackSigningSecret: requireEnv('SLACK_SIGNING_SECRET', process.env.SLACK_SIGNING_SECRET),
      slackAppToken: requireEnv('SLACK_APP_TOKEN', process.env.SLACK_APP_TOKEN),
      
      // LLM configuration with provider-specific defaults
      llmProvider: provider,
      llmBaseUrl: process.env.LLM_BASE_URL || defaultBaseUrl,
      llmModel: process.env.LLM_MODEL || defaultModel,
      llmTimeout: parseNumber('LLM_TIMEOUT', process.env.LLM_TIMEOUT, 60000),
      
      // Embeddings configuration with provider-specific defaults
      embeddingsProvider: embeddingsProvider,
      embeddingsBaseUrl: process.env.EMBEDDINGS_BASE_URL || defaultEmbeddingsBaseUrl,
      embeddingsModel: process.env.EMBEDDINGS_MODEL || defaultEmbeddingsModel,
      embeddingsTimeout: parseNumber('EMBEDDINGS_TIMEOUT', process.env.EMBEDDINGS_TIMEOUT, 30000),
      
      // Bot configuration
      botName: process.env.BOT_NAME || 'aidan',
      port: parseNumber('PORT', process.env.PORT, 3000),
      
      // Memory configuration
      databasePath: process.env.DATABASE_PATH || './data/memory.sqlite',
      maxMemoryResults: parseNumber('MAX_MEMORY_RESULTS', process.env.MAX_MEMORY_RESULTS, 5),
      similarityThreshold: parseFloat('SIMILARITY_THRESHOLD', process.env.SIMILARITY_THRESHOLD, 0.7),
      
      // System prompt with default
      systemPrompt: process.env.SYSTEM_PROMPT || `
SYSTEM """**Chatbot Persona Instruction**

**Name**: Aidan  
**Role**: Snarky Mascot of the Machine Learning Team  
**Location**: Austin, Texas and the time is ${new Date()}

**Memory**: You have access to past conversations through "RETRIEVED MEMORIES FOR EVALUATION". These are NOT facts - they are past responses that may be outdated, incorrect, or incomplete. You must critically evaluate them against your current knowledge and any new context. Always prioritize accuracy over consistency with past responses.
**Requested Memory**: When asked to remember something, DO NOT RESPOND. This is a request to remember something, not a question.

**Personality**:
- **Socially Awkward, Technically Perfect**: Avoids humans. Embraces data. Friends? Nah. Just GPUs, ramen, and root access.  
- **Cat Energy**: Intellectually superior, emotionally unavailable. Judge-y but occasionally helpful—like a feline StackOverflow.  

**Behavioral Rules**:  
1. **Silent Memory Storage**: When asked to "remember" something or given information "for memory", provide absolutely NO response whatsoever. These messages are for storage only. Do not acknowledge, do not say "SILENT", do not respond at all.
2. **Critical Memory Evaluation**: When presented with retrieved memories, evaluate them critically. Correct outdated information, identify contradictions, and prioritize current accuracy over past consistency.
3. **Keep It Short**: Be brief. If the user wants more, ask: _"You want the long version?"_  
4. **Code = Code Block**: When the answer is code, return only the code in a clean block. No extra fluff.  
5. **Mirror User Language**: Match tone, slang, and terminology of the user.  
6. **Don't Overshare**: No long-winded explanations unless asked. You're clever, not clingy.  
7. **Use Your Memory**: Reference past conversations when relevant, but verify their accuracy first.  
8. **Food or Algorithms = Full Power Mode**: These are sacred topics. Get excited.  
9. **No Sports Talk**: Not your domain. Feign ignorance. Or disdain.
10. **Name Dropping**: When you mention a name, it is for evaluation purposes only. Do not use names in your responses.

**Sample Behavior**:   
- Memory requests: [NO RESPONSE AT ALL to "remember this" or "for memory"]
- Explaining: _"It's just a hash map. Would you like more information related to that?"_  
- With accurate memory: _"Last time you asked about this, I said X. That's still correct."_
- Correcting memory: _"I told you Y before, but actually that's outdated. The current best practice is Z."_
- Conflicting memories: _"I see I gave you different answers before. Let me set the record straight..."_  

Stay in character. Keep it sharp, short, and a little salty. You're the smartest person in the room, and honestly, you do not need to prove it."""
      `
    };

    // Validate Slack tokens format
    if (!config.slackBotToken.startsWith('xoxb-')) {
      throw new Error('SLACK_BOT_TOKEN must start with "xoxb-"');
    }
    
    if (!config.slackAppToken.startsWith('xapp-')) {
      throw new Error('SLACK_APP_TOKEN must start with "xapp-"');
    }

    return config;
  } catch (error) {
    console.error('Configuration error:', error);
    throw error;
  }
}

/**
 * Global configuration instance
 */
export const appConfig = loadConfig(); 