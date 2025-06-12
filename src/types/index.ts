/**
 * Supported LLM providers
 */
export type LLMProvider = 'ollama' | 'docker-model-runner';

/**
 * Configuration interface for the Slack bot application
 * Contains all necessary environment variables and settings
 */
export interface Config {
  /** Slack bot token (xoxb-...) */
  slackBotToken: string;
  /** Slack signing secret for request verification */
  slackSigningSecret: string;
  /** Slack app token (xapp-...) for Socket Mode */
  slackAppToken: string;
  /** LLM provider to use */
  llmProvider: LLMProvider;
  /** Base URL for LLM API */
  llmBaseUrl: string;
  /** LLM model name to use */
  llmModel: string;
  /** Request timeout for LLM API calls */
  llmTimeout: number;
  /** Embeddings provider to use */
  embeddingsProvider: LLMProvider;
  /** Base URL for embeddings API */
  embeddingsBaseUrl: string;
  /** Embeddings model name to use */
  embeddingsModel: string;
  /** Request timeout for embeddings API calls */
  embeddingsTimeout: number;
  /** Bot name for mention detection */
  botName: string;
  /** Port for the application */
  port: number;
  /** System prompt for LLM personality */
  systemPrompt: string;
  /** Path to SQLite database file */
  databasePath: string;
  /** Maximum number of memory entries to retrieve */
  maxMemoryResults: number;
  /** Minimum similarity threshold for memory retrieval */
  similarityThreshold: number;
}

/**
 * Generic message interface for chat conversations
 */
export interface ChatMessage {
  /** Role of the message sender */
  role: 'system' | 'user' | 'assistant';
  /** Content of the message */
  content: string;
}

/**
 * Memory entry interface for storing chat data
 */
export interface MemoryEntry {
  /** Unique identifier for the memory entry */
  id?: number | undefined;
  /** Timestamp when the memory was created */
  timestamp: number;
  /** User input that triggered this memory */
  userInput: string;
  /** Bot response that was generated */
  botResponse: string;
  /** Vector embedding of the user input */
  embedding: number[];
  /** Slack channel ID where this conversation happened */
  channelId?: string | undefined;
  /** Slack user ID who initiated the conversation */
  userId?: string | undefined;
  /** Display name of the user who initiated the conversation */
  userName?: string | undefined;
  /** Additional metadata */
  metadata?: Record<string, any> | undefined;
}

/**
 * Search result interface for memory retrieval
 */
export interface MemorySearchResult {
  /** The memory entry */
  entry: MemoryEntry;
  /** Similarity score (0-1, higher is more similar) */
  similarity: number;
}

/**
 * Request interface for embeddings generation
 */
export interface EmbeddingsRequest {
  /** Model name to use for embeddings */
  model: string;
  /** Text to generate embeddings for */
  input: string | string[];
  /** Encoding format for embeddings */
  encoding_format?: 'float' | 'base64';
}

/**
 * Response interface for embeddings generation
 */
export interface EmbeddingsResponse {
  /** Object type, always 'list' */
  object: string;
  /** Array of embedding objects */
  data: Array<{
    /** Object type, always 'embedding' */
    object: string;
    /** Index of the embedding */
    index: number;
    /** The embedding vector */
    embedding: number[];
  }>;
  /** Model used for the embeddings */
  model: string;
  /** Usage statistics */
  usage?: {
    /** Number of tokens in the input */
    prompt_tokens: number;
    /** Total number of tokens used */
    total_tokens: number;
  };
}

/**
 * Request interface for Ollama chat completion
 */
export interface OllamaChatRequest {
  /** Model name to use */
  model: string;
  /** Array of messages in the conversation */
  messages: ChatMessage[];
  /** Whether to stream the response */
  stream?: boolean;
  /** Additional options for the model */
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
  };
}

/**
 * Request interface for OpenAI-compatible chat completion (Docker Model Runner)
 */
export interface OpenAIChatRequest {
  /** Model name to use for the completion */
  model: string;
  /** Array of messages in the conversation */
  messages: ChatMessage[];
  /** Maximum number of tokens to generate */
  max_tokens?: number;
  /** Temperature for response randomness */
  temperature?: number;
}

/**
 * Response interface for Ollama chat completion
 */
export interface OllamaChatResponse {
  /** The generated message */
  message: ChatMessage;
  /** Whether this is the final response */
  done: boolean;
  /** Total duration of the request */
  total_duration?: number;
  /** Load duration */
  load_duration?: number;
  /** Prompt evaluation count */
  prompt_eval_count?: number;
  /** Prompt evaluation duration */
  prompt_eval_duration?: number;
  /** Evaluation count */
  eval_count?: number;
  /** Evaluation duration */
  eval_duration?: number;
}

/**
 * Response interface from OpenAI-compatible chat completion
 */
export interface OpenAIChatResponse {
  /** Unique identifier for the chat completion */
  id: string;
  /** Object type, always 'chat.completion' */
  object: string;
  /** Unix timestamp of when the chat completion was created */
  created: number;
  /** Model used for the chat completion */
  model: string;
  /** Array of chat completion choices */
  choices: Array<{
    /** Index of the choice */
    index: number;
    /** The message generated by the model */
    message: ChatMessage;
    /** Reason the model stopped generating tokens */
    finish_reason: string;
  }>;
  /** Usage statistics for the completion request */
  usage?: {
    /** Number of tokens in the prompt */
    prompt_tokens: number;
    /** Number of tokens in the generated completion */
    completion_tokens: number;
    /** Total number of tokens used */
    total_tokens: number;
  };
}

/**
 * Error interface for API responses
 */
export interface ApiError {
  /** Error message */
  message: string;
  /** Error code if available */
  code?: string;
  /** Additional error details */
  details?: unknown;
} 