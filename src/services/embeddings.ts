import axios, { AxiosInstance, AxiosError } from 'axios';
import { 
  EmbeddingsRequest, 
  EmbeddingsResponse, 
  ApiError,
  LLMProvider 
} from '../types';
import { appConfig } from '../config';

/**
 * Service class for generating text embeddings using LLM APIs
 * Supports both Ollama and Docker Model Runner for embeddings generation
 */
export class EmbeddingsService {
  private client: AxiosInstance;
  private provider: LLMProvider;
  private model: string;

  /**
   * Creates a new EmbeddingsService instance
   * Configures axios client with embeddings-specific settings
   */
  constructor() {
    this.provider = appConfig.embeddingsProvider;
    this.model = appConfig.embeddingsModel;
    
    this.client = axios.create({
      baseURL: appConfig.embeddingsBaseUrl,
      timeout: appConfig.embeddingsTimeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        console.log(`[${this.provider}] Embeddings request to: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error(`[${this.provider}] Embeddings request error:`, error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        console.log(`[${this.provider}] Embeddings response received: ${response.status}`);
        return response;
      },
      (error) => {
        console.error(`[${this.provider}] Embeddings response error:`, error.response?.status, error.message);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Tests connection to the embeddings service
   * @returns Promise that resolves when connection is successful
   */
  async testConnection(): Promise<void> {
    try {
      if (this.provider === 'docker-model-runner') {
        await this.client.get('/engines/llama.cpp/v1/models');
      } else {
        await this.client.get('/api/tags');
      }
      console.log(`[${this.provider}] Embeddings connection test successful`);
    } catch (error) {
      console.error(`[${this.provider}] Embeddings connection test failed:`, error);
      throw new Error(`Failed to connect to ${this.provider} for embeddings: ${error}`);
    }
  }

  /**
   * Generates embeddings for the given text
   * @param text - Text to generate embeddings for
   * @returns Promise resolving to the embedding vector
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      // Truncate text if too long (most embedding models have token limits)
      const maxLength = 8000; // Conservative limit for most embedding models
      const truncatedText = text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
      
      if (text.length > maxLength) {
        console.log(`[${this.provider}] Truncated text from ${text.length} to ${truncatedText.length} characters for embeddings`);
      }

      if (this.provider === 'docker-model-runner') {
        return await this.generateEmbeddingWithDockerModelRunner(truncatedText);
      } else {
        return await this.generateEmbeddingWithOllama(truncatedText);
      }
    } catch (error) {
      console.error(`[${this.provider}] Embedding generation error:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Generates embeddings for multiple texts
   * @param texts - Array of texts to generate embeddings for
   * @returns Promise resolving to array of embedding vectors
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      // For now, generate embeddings one by one to avoid overwhelming the API
      // This could be optimized for batch processing if the API supports it
      const embeddings: number[][] = [];
      for (const text of texts) {
        const embedding = await this.generateEmbedding(text);
        embeddings.push(embedding);
      }
      return embeddings;
    } catch (error) {
      console.error(`[${this.provider}] Batch embedding generation error:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Handles embedding generation with Docker Model Runner (OpenAI-compatible API)
   * @param text - Text to generate embeddings for
   * @returns Promise resolving to the embedding vector
   */
  private async generateEmbeddingWithDockerModelRunner(text: string): Promise<number[]> {
    const request: EmbeddingsRequest = {
      model: this.model,
      input: text,
      encoding_format: 'float'
    };

    const response = await this.client.post<EmbeddingsResponse>(
      '/engines/llama.cpp/v1/embeddings',
      request
    );

    const embedding = response.data.data?.[0]?.embedding;
    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('Invalid embedding response format from Docker Model Runner');
    }

    return embedding;
  }

  /**
   * Handles embedding generation with Ollama
   * @param text - Text to generate embeddings for
   * @returns Promise resolving to the embedding vector
   */
  private async generateEmbeddingWithOllama(text: string): Promise<number[]> {
    const request = {
      model: this.model,
      prompt: text
    };

    const response = await this.client.post('/api/embeddings', request);

    const embedding = response.data.embedding;
    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('Invalid embedding response format from Ollama');
    }

    return embedding;
  }

  /**
   * Handles and formats errors from the embeddings service
   * @param error - The error to handle
   * @returns Formatted ApiError
   */
  private handleError(error: unknown): ApiError {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.code === 'ECONNREFUSED') {
        return {
          message: `Cannot connect to ${this.provider} for embeddings. Is it running?`,
          code: 'CONNECTION_REFUSED',
          details: axiosError.message
        };
      }
      
      if (axiosError.code === 'ECONNABORTED') {
        return {
          message: `Embeddings request to ${this.provider} timed out`,
          code: 'TIMEOUT',
          details: axiosError.message
        };
      }
      
      if (axiosError.response) {
        return {
          message: `${this.provider} embeddings API error: ${axiosError.response.status}`,
          code: axiosError.response.status.toString(),
          details: axiosError.response.data
        };
      }
    }
    
    return {
      message: `Unexpected error with ${this.provider} embeddings`,
      code: 'UNKNOWN_ERROR',
      details: error
    };
  }
} 