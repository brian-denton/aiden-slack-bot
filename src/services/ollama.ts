import axios, { AxiosInstance, AxiosError } from 'axios';
import { 
  OllamaChatRequest, 
  OllamaChatResponse, 
  OpenAIChatRequest,
  OpenAIChatResponse,
  ChatMessage, 
  ApiError,
  LLMProvider 
} from '../types';
import { appConfig } from '../config';
import { MemoryService } from './memory';

/**
 * Service class for interacting with LLM APIs (Ollama or Docker Model Runner)
 * Handles chat completions and error management for multiple providers
 * Integrates with memory service for context-aware responses
 */
export class LLMService {
  private client: AxiosInstance;
  private provider: LLMProvider;
  private memoryService: MemoryService;

  /**
   * Creates a new LLMService instance
   * Configures axios client with base URL and timeout based on provider
   */
  constructor() {
    this.provider = appConfig.llmProvider;
    this.memoryService = new MemoryService();
    
    this.client = axios.create({
      baseURL: appConfig.llmBaseUrl,
      timeout: appConfig.llmTimeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        console.log(`[${this.provider}] Making request to: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error(`[${this.provider}] Request error:`, error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        console.log(`[${this.provider}] Response received: ${response.status}`);
        return response;
      },
      (error) => {
        console.error(`[${this.provider}] Response error:`, error.response?.status, error.message);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Tests connection to the LLM service and initializes memory service
   * @returns Promise that resolves when connection is successful
   */
  async testConnection(): Promise<void> {
    try {
      if (this.provider === 'docker-model-runner') {
        await this.client.get('/engines/llama.cpp/v1/models');
      } else {
        await this.client.get('/api/tags');
      }
      console.log(`[${this.provider}] Connection test successful`);
      
      // Initialize memory service
      try {
        await this.memoryService.initialize();
      } catch (error) {
        console.warn(`[${this.provider}] Memory service initialization failed, continuing without memory:`, error);
      }
    } catch (error) {
      console.error(`[${this.provider}] Connection test failed:`, error);
      throw new Error(`Failed to connect to ${this.provider}: ${error}`);
    }
  }

  /**
   * Lists available models from the LLM service
   * @returns Promise resolving to array of model names
   */
  async listModels(): Promise<string[]> {
    try {
      if (this.provider === 'docker-model-runner') {
        const response = await this.client.get('/engines/llama.cpp/v1/models');
        return response.data.data?.map((model: any) => model.id) || [];
      } else {
        const response = await this.client.get('/api/tags');
        return response.data.models?.map((model: any) => model.name) || [];
      }
    } catch (error) {
      console.error(`[${this.provider}] Failed to list models:`, error);
      return [];
    }
  }

  /**
   * Sends a chat message to the LLM and returns the response
   * @param userMessage - The user's message
   * @param conversationHistory - Optional previous messages in the conversation
   * @param channelId - Optional Slack channel ID for memory context
   * @param userId - Optional Slack user ID for memory context
   * @param userName - Optional user display name for memory context
   * @returns Promise resolving to the LLM's response
   */
  async chat(
    userMessage: string, 
    conversationHistory: ChatMessage[] = [],
    channelId?: string,
    userId?: string,
    userName?: string
  ): Promise<string> {
    try {
      // Get enhanced context with memory if available
      let enhancedUserMessage = userMessage;
      try {
        enhancedUserMessage = await this.memoryService.getEnhancedContext(
          userMessage,
          channelId,
          userId,
          userName
        );
      } catch (error) {
        console.warn(`[${this.provider}] Failed to enhance context with memory, using original message:`, error);
      }

      // Use structured thinking process for question processing
      const response = await this.processWithStructuredThinking(
        enhancedUserMessage,
        conversationHistory
      );

      // Store only the original question and final summary in memory (async, don't wait)
      // Note: Planning and reasoning phases are not stored - only the final response
      this.storeMemoryAsync(userMessage, response, channelId, userId, userName);

      return response;
    } catch (error) {
      console.error(`[${this.provider}] Chat error:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Processes a question through a 3-cycle structured thinking approach
   * 1. Planning - Understand the question and plan the approach
   * 2. Reasoning - Work through the logic and analysis
   * 3. Summary - Provide the final concise response
   * @param userMessage - The enhanced user message with context
   * @param conversationHistory - Previous conversation messages
   * @returns Promise resolving to the final summary response
   */
  private async processWithStructuredThinking(
    userMessage: string,
    conversationHistory: ChatMessage[]
  ): Promise<string> {
    console.log(`[${this.provider}] Starting structured thinking process...`);

    // Cycle 1: Planning
    console.log(`[${this.provider}] Phase 1: Planning`);
    const planningPrompt = `${appConfig.systemPrompt}

STRUCTURED THINKING - PHASE 1: PLANNING

Your task is to plan how to approach the following question/request. Think about:
- What is the user actually asking for?
- What information or analysis do I need to provide?
- What approach should I take to answer this effectively?
- Are there any considerations or edge cases I should think about?

Provide a clear plan for how you will approach this question. Be thorough but concise.

User's question: ${userMessage}`;

    const planningMessages: ChatMessage[] = [
      { role: 'system', content: planningPrompt },
      ...conversationHistory
    ];

    const planningResponse = await this.executeThinkingPhase(planningMessages, 'Planning');

    // Cycle 2: Reasoning
    console.log(`[${this.provider}] Phase 2: Reasoning`);
    const reasoningPrompt = `${appConfig.systemPrompt}

STRUCTURED THINKING - PHASE 2: REASONING

Based on your planning, now work through the logic and analysis needed to answer the question.

Your planning was:
${planningResponse}

Now execute that plan. Think through:
- Step-by-step analysis or solution
- Consider different perspectives or approaches
- Work through any logic or calculations
- Identify key insights or conclusions

User's question: ${userMessage}`;

    const reasoningMessages: ChatMessage[] = [
      { role: 'system', content: reasoningPrompt },
      ...conversationHistory
    ];

    const reasoningResponse = await this.executeThinkingPhase(reasoningMessages, 'Reasoning');

    // Cycle 3: Summary
    console.log(`[${this.provider}] Phase 3: Summary`);
    const summaryPrompt = `${appConfig.systemPrompt}

STRUCTURED THINKING - PHASE 3: SUMMARY

Based on your planning and reasoning, provide the final response to the user.

Your planning was:
${planningResponse}

Your reasoning was:
${reasoningResponse}

Now provide a clear, concise, and helpful final response that directly addresses the user's question. This is what will be sent to the user, so make it:
- Clear and easy to understand
- Complete but not overly verbose
- Actionable when appropriate
- In your characteristic personality/tone

User's question: ${userMessage}`;

    const summaryMessages: ChatMessage[] = [
      { role: 'system', content: summaryPrompt },
      ...conversationHistory
    ];

    const finalResponse = await this.executeThinkingPhase(summaryMessages, 'Summary');
    
    console.log(`[${this.provider}] Structured thinking process completed`);
    console.log(`[${this.provider}] Final response ready for user and memory storage`);
    return finalResponse;
  }

  /**
   * Executes a single phase of the thinking process
   * @param messages - Messages for this thinking phase
   * @param phaseName - Name of the current phase for logging
   * @returns Promise resolving to the phase response
   */
  private async executeThinkingPhase(messages: ChatMessage[], phaseName: string): Promise<string> {
    let response: string;
    if (this.provider === 'docker-model-runner') {
      response = await this.chatWithDockerModelRunner(messages);
    } else {
      response = await this.chatWithOllama(messages);
    }
    
    console.log(`[${this.provider}] ${phaseName} phase completed`);
    return response;
  }

  /**
   * Handles chat with Docker Model Runner (OpenAI-compatible API)
   * @param messages - Array of chat messages
   * @returns Promise resolving to the assistant's response
   */
  private async chatWithDockerModelRunner(messages: ChatMessage[]): Promise<string> {
    const request: OpenAIChatRequest = {
      model: appConfig.llmModel,
      messages,
      max_tokens: 1000,
      temperature: 0.7
    };

    const response = await this.client.post<OpenAIChatResponse>(
      '/engines/llama.cpp/v1/chat/completions',
      request
    );

    const choice = response.data.choices?.[0];
    if (!choice?.message?.content) {
      throw new Error('Invalid response format from Docker Model Runner');
    }

    return choice.message.content;
  }

  /**
   * Handles chat with Ollama
   * @param messages - Array of chat messages
   * @returns Promise resolving to the assistant's response
   */
  private async chatWithOllama(messages: ChatMessage[]): Promise<string> {
    const request: OllamaChatRequest = {
      model: appConfig.llmModel,
      messages,
      stream: false,
      options: {
        temperature: 0.7
      }
    };

    const response = await this.client.post<OllamaChatResponse>('/api/chat', request);

    if (!response.data.message?.content) {
      throw new Error('Invalid response format from Ollama');
    }

    return response.data.message.content;
  }

  /**
   * Handles and formats errors from the LLM service
   * @param error - The error to handle
   * @returns Formatted ApiError
   */
  private handleError(error: unknown): ApiError {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.code === 'ECONNREFUSED') {
        return {
          message: `Cannot connect to ${this.provider}. Is it running?`,
          code: 'CONNECTION_REFUSED',
          details: axiosError.message
        };
      }
      
      if (axiosError.code === 'ECONNABORTED') {
        return {
          message: `Request to ${this.provider} timed out`,
          code: 'TIMEOUT',
          details: axiosError.message
        };
      }
      
      if (axiosError.response) {
        return {
          message: `${this.provider} API error: ${axiosError.response.status}`,
          code: axiosError.response.status.toString(),
          details: axiosError.response.data
        };
      }
    }
    
    return {
      message: `Unexpected error with ${this.provider}`,
      code: 'UNKNOWN_ERROR',
      details: error
    };
  }

  /**
   * Asynchronously stores a memory entry without blocking the response
   * @param userInput - The user's input message
   * @param botResponse - The bot's response message
   * @param channelId - Optional Slack channel ID
   * @param userId - Optional Slack user ID
   * @param userName - Optional user display name
   */
  private storeMemoryAsync(
    userInput: string,
    botResponse: string,
    channelId?: string,
    userId?: string,
    userName?: string
  ): void {
    // Store memory asynchronously without blocking the response
    this.memoryService.storeMemory(userInput, botResponse, channelId, userId, { userName })
      .then((entry) => {
        console.log(`[${this.provider}] Memory stored with ID: ${entry.id}`);
      })
      .catch((error) => {
        console.warn(`[${this.provider}] Failed to store memory:`, error);
      });
  }

  /**
   * Gets memory service instance for external access
   * @returns The memory service instance
   */
  getMemoryService(): MemoryService {
    return this.memoryService;
  }
} 