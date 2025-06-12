import { EmbeddingsService } from './embeddings';
import { VectorStore } from './vectorstore';
import { MemoryEntry, MemorySearchResult } from '../types';
import { appConfig } from '../config';

/**
 * Main memory service that orchestrates embeddings and vector storage
 * Provides high-level memory operations for the chatbot
 */
export class MemoryService {
  private embeddingsService: EmbeddingsService;
  private vectorStore: VectorStore;
  private initialized: boolean = false;

  /**
   * Creates a new MemoryService instance
   * Initializes embeddings service and vector store
   */
  constructor() {
    this.embeddingsService = new EmbeddingsService();
    this.vectorStore = new VectorStore();
  }

  /**
   * Initializes the memory service
   * Tests connections to both embeddings and vector store
   */
  async initialize(): Promise<void> {
    try {
      console.log('[MemoryService] Initializing memory service...');
      
      // Test embeddings service connection
      await this.embeddingsService.testConnection();
      
      // Get memory count for logging
      const memoryCount = await this.vectorStore.getMemoryCount();
      console.log(`[MemoryService] Vector store ready with ${memoryCount} stored memories`);
      
      this.initialized = true;
      console.log('[MemoryService] Memory service initialized successfully');
    } catch (error) {
      console.error('[MemoryService] Failed to initialize:', error);
      throw new Error(`Memory service initialization failed: ${error}`);
    }
  }

  /**
   * Stores a new memory entry from a chat interaction
   * @param userInput - The user's input message
   * @param botResponse - The bot's response message
   * @param channelId - Optional Slack channel ID
   * @param userId - Optional Slack user ID
   * @param metadata - Optional additional metadata
   * @returns Promise resolving to the stored memory entry
   */
  async storeMemory(
    userInput: string,
    botResponse: string,
    channelId?: string,
    userId?: string,
    metadata?: Record<string, any>
  ): Promise<MemoryEntry> {
    try {
      // Try to initialize if not already done
      if (!this.initialized) {
        await this.initialize();
      }

      console.log('[MemoryService] Storing new memory...');
      
      // Generate embedding for the user input
      const embedding = await this.embeddingsService.generateEmbedding(userInput);
      
      // Extract userName from metadata if provided
      const userName = metadata?.userName;
      const remainingMetadata = { ...metadata };
      delete remainingMetadata?.userName;
      
      // Create memory entry
      const memoryEntry: MemoryEntry = {
        timestamp: Date.now(),
        userInput,
        botResponse,
        embedding,
        ...(channelId && { channelId }),
        ...(userId && { userId }),
        ...(userName && { userName }),
        ...(Object.keys(remainingMetadata).length > 0 && { metadata: remainingMetadata })
      };

      // Store in vector database
      const storedEntry = await this.vectorStore.storeMemory(memoryEntry);
      
      console.log(`[MemoryService] Memory stored successfully with ID: ${storedEntry.id}`);
      return storedEntry;
    } catch (error) {
      console.error('[MemoryService] Error storing memory:', error);
      throw new Error(`Failed to store memory: ${error}`);
    }
  }

  /**
   * Searches for relevant memories based on a query
   * @param query - The search query (user input)
   * @param channelId - Optional channel ID to filter by
   * @param userId - Optional user ID to filter by
   * @param limit - Maximum number of results to return
   * @returns Promise resolving to array of relevant memory search results
   */
  async searchMemories(
    query: string,
    channelId?: string,
    userId?: string,
    limit: number = appConfig.maxMemoryResults
  ): Promise<MemorySearchResult[]> {
    try {
      // Try to initialize if not already done
      if (!this.initialized) {
        await this.initialize();
      }

      console.log(`[MemoryService] Searching memories for query: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`);
      
      // Generate embedding for the query
      const queryEmbedding = await this.embeddingsService.generateEmbedding(query);
      
      // Search vector store for similar memories
      const results = await this.vectorStore.searchSimilar(
        queryEmbedding,
        limit,
        channelId,
        userId
      );

      console.log(`[MemoryService] Found ${results.length} relevant memories`);
      return results;
    } catch (error) {
      console.error('[MemoryService] Error searching memories:', error);
      return []; // Return empty array instead of throwing
    }
  }

  /**
   * Gets recent memories without similarity filtering
   * @param channelId - Optional channel ID to filter by
   * @param userId - Optional user ID to filter by
   * @param limit - Maximum number of results to return
   * @returns Promise resolving to array of recent memory entries
   */
  async getRecentMemories(
    channelId?: string,
    userId?: string,
    limit: number = appConfig.maxMemoryResults
  ): Promise<MemoryEntry[]> {
    this.ensureInitialized();

    try {
      console.log('[MemoryService] Retrieving recent memories...');
      
      const memories = await this.vectorStore.getRecentMemories(limit, channelId, userId);
      
      console.log(`[MemoryService] Retrieved ${memories.length} recent memories`);
      return memories;
    } catch (error) {
      console.error('[MemoryService] Error getting recent memories:', error);
      throw new Error(`Failed to get recent memories: ${error}`);
    }
  }

  /**
   * Formats memory search results for inclusion in chat context
   * @param searchResults - Array of memory search results
   * @returns Formatted string for LLM context
   */
  formatMemoriesForLLM(searchResults: MemorySearchResult[]): string {
    if (searchResults.length === 0) {
      return '';
    }

    let formattedMemories = '\n--- RETRIEVED MEMORIES FOR EVALUATION ---\n';
    formattedMemories += 'IMPORTANT: These are past conversations that may or may not be accurate or current.\n';
    formattedMemories += 'You must evaluate them against your current knowledge and any new context provided.\n\n';
    
    if (searchResults.length === 1) {
      // Single memory - provide for evaluation
      const { entry, similarity } = searchResults[0];
      const timestamp = new Date(entry.timestamp).toISOString();
      const userLabel = entry.userName ? `${entry.userName}` : 'User';
      
      formattedMemories += `Past conversation (similarity: ${similarity.toFixed(3)}, from ${timestamp}):\n`;
      formattedMemories += `${userLabel}: ${entry.userInput}\n`;
      formattedMemories += `Previous Assistant Response: ${entry.botResponse}\n\n`;
      formattedMemories += '--- END RETRIEVED MEMORY ---\n\n';
      formattedMemories += 'EVALUATION INSTRUCTIONS:\n';
      formattedMemories += '• Compare this past response with your current knowledge\n';
      formattedMemories += '• Consider if information may have changed since this conversation\n';
      formattedMemories += '• Determine if the previous answer is still accurate and complete\n';
      formattedMemories += '• If the memory is outdated or incorrect, provide an updated answer\n';
      formattedMemories += '• If the memory is accurate, you may reference it but add any new insights\n';
      formattedMemories += '• Always prioritize accuracy over consistency with past responses\n\n';
    } else {
      // Multiple memories - provide for evaluation and synthesis
      formattedMemories += `Found ${searchResults.length} potentially relevant past conversations:\n\n`;
      
      searchResults.forEach((result, index) => {
        const { entry, similarity } = result;
        const timestamp = new Date(entry.timestamp).toISOString();
        const userLabel = entry.userName ? `${entry.userName}` : 'User';
        
        formattedMemories += `Memory ${index + 1} (similarity: ${similarity.toFixed(3)}, from ${timestamp}):\n`;
        formattedMemories += `${userLabel}: ${entry.userInput}\n`;
        formattedMemories += `Previous Response: ${entry.botResponse}\n\n`;
      });
      
      formattedMemories += '--- END RETRIEVED MEMORIES ---\n\n';
      formattedMemories += 'EVALUATION AND SYNTHESIS INSTRUCTIONS:\n';
      formattedMemories += '• Review each past conversation critically\n';
      formattedMemories += '• Identify which information is still accurate and which may be outdated\n';
      formattedMemories += '• Look for contradictions between memories or with your current knowledge\n';
      formattedMemories += '• Synthesize the best information from multiple sources\n';
      formattedMemories += '• Provide the most accurate and up-to-date answer possible\n';
      formattedMemories += '• You may reference past conversations but are not bound by them\n';
      formattedMemories += '• If memories contain errors, correct them in your response\n';
      formattedMemories += '• Mention when you\'re updating or correcting previous information\n\n';
    }
    
    return formattedMemories;
  }

  /**
   * Combines memory search with a user query for enhanced context
   * @param userQuery - The user's current query
   * @param channelId - Optional channel ID to filter by
   * @param userId - Optional user ID to filter by
   * @param userName - Optional user display name for context
   * @returns Promise resolving to enhanced context string
   */
  async getEnhancedContext(
    userQuery: string,
    channelId?: string,
    userId?: string,
    userName?: string
  ): Promise<string> {
    try {
      // Try to initialize if not already done
      if (!this.initialized) {
        await this.initialize();
      }

      // Search for relevant memories
      const memories = await this.searchMemories(userQuery, channelId, userId);
      
      // Format memories for LLM context
      const memoryContext = this.formatMemoriesForLLM(memories);
      
      // Combine with current query
      let enhancedContext = userQuery;
      
      if (memoryContext) {
        const userPrefix = userName ? `${userName} asks: ` : '';
        enhancedContext = memoryContext + '\nCurrent Question: ' + userPrefix + userQuery;
      } else if (userName) {
        enhancedContext = `${userName} asks: ${userQuery}`;
      }
      
      return enhancedContext;
    } catch (error) {
      console.error('[MemoryService] Error getting enhanced context:', error);
      // Return original query if memory enhancement fails
      return userQuery;
    }
  }

  /**
   * Gets memory statistics
   * @returns Promise resolving to memory statistics
   */
  async getStats(): Promise<{
    totalMemories: number;
    embeddingsProvider: string;
    embeddingsModel: string;
    databasePath: string;
    similarityThreshold: number;
  }> {
    this.ensureInitialized();

    try {
      const totalMemories = await this.vectorStore.getMemoryCount();
      
      return {
        totalMemories,
        embeddingsProvider: appConfig.embeddingsProvider,
        embeddingsModel: appConfig.embeddingsModel,
        databasePath: appConfig.databasePath,
        similarityThreshold: appConfig.similarityThreshold
      };
    } catch (error) {
      console.error('[MemoryService] Error getting stats:', error);
      throw new Error(`Failed to get memory stats: ${error}`);
    }
  }

  /**
   * Performs maintenance on the memory system
   * @returns Promise that resolves when maintenance is complete
   */
  async performMaintenance(): Promise<void> {
    this.ensureInitialized();

    try {
      console.log('[MemoryService] Starting memory system maintenance...');
      
      await this.vectorStore.maintenance();
      
      console.log('[MemoryService] Memory system maintenance completed');
    } catch (error) {
      console.error('[MemoryService] Error during maintenance:', error);
      throw new Error(`Memory maintenance failed: ${error}`);
    }
  }

  /**
   * Deletes a memory by ID
   * @param id - ID of the memory to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteMemory(id: number): Promise<boolean> {
    this.ensureInitialized();

    try {
      return await this.vectorStore.deleteMemory(id);
    } catch (error) {
      console.error('[MemoryService] Error deleting memory:', error);
      throw new Error(`Failed to delete memory: ${error}`);
    }
  }

  /**
   * Closes the memory service and cleans up resources
   */
  close(): void {
    try {
      this.vectorStore.close();
      this.initialized = false;
      console.log('[MemoryService] Memory service closed');
    } catch (error) {
      console.error('[MemoryService] Error closing memory service:', error);
    }
  }

  /**
   * Ensures the memory service is initialized before operations
   * @throws Error if not initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Memory service not initialized. Call initialize() first.');
    }
  }
} 