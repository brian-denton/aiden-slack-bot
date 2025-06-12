import initSqlJs, { Database } from 'sql.js';
import { MemoryEntry, MemorySearchResult } from '../types';
import { appConfig } from '../config';
import { promises as fs } from 'fs';
import { dirname } from 'path';

/**
 * SQLite-based vector store for storing and retrieving chat memories
 * Uses sql.js (pure JavaScript) to avoid native compilation issues
 */
export class VectorStore {
  private db?: Database;
  private initialized = false;

  /**
   * Creates a new VectorStore instance
   */
  constructor() {
    // Initialization is async, so we'll do it lazily
  }

  /**
   * Ensures the database is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized && this.db) return;

    try {
      // Initialize SQL.js
      const SQL = await initSqlJs();
      
      // Try to load existing database or create new one
      let dbBuffer: Uint8Array | undefined;
      
      try {
        // Ensure the database directory exists
        const dbDir = dirname(appConfig.databasePath);
        await fs.mkdir(dbDir, { recursive: true });
        
        // Try to read existing database
        dbBuffer = await fs.readFile(appConfig.databasePath);
      } catch (error) {
        // Database doesn't exist, will create new one
        console.log('[VectorStore] Creating new database');
      }

      // Create database instance
      this.db = new SQL.Database(dbBuffer);
      
      // Create the memories table if it doesn't exist
      this.createTables();
      
      this.initialized = true;
      console.log(`[VectorStore] Initialized with database: ${appConfig.databasePath}`);
    } catch (error) {
      console.error('[VectorStore] Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Creates the necessary database tables
   */
  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    const createMemoriesTable = `
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        user_input TEXT NOT NULL,
        bot_response TEXT NOT NULL,
        embedding TEXT NOT NULL,
        channel_id TEXT,
        user_id TEXT,
        user_name TEXT,
        metadata TEXT
      )
    `;

    const createIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_memories_channel_id ON memories(channel_id)',
      'CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id)'
    ];

    this.db.run(createMemoriesTable);
    createIndexes.forEach(indexSql => this.db!.run(indexSql));
  }

  /**
   * Saves the database to disk
   */
  private async saveDatabase(): Promise<void> {
    if (!this.db) return;

    try {
      const data = this.db.export();
      await fs.writeFile(appConfig.databasePath, data);
    } catch (error) {
      console.error('[VectorStore] Failed to save database:', error);
    }
  }

  /**
   * Stores a memory entry in the vector store
   */
  async storeMemory(entry: MemoryEntry): Promise<MemoryEntry> {
    await this.ensureInitialized();
    if (!this.db) throw new Error('Database not initialized');

    try {
      const stmt = this.db.prepare(`
        INSERT INTO memories (timestamp, user_input, bot_response, embedding, channel_id, user_id, user_name, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run([
        entry.timestamp,
        entry.userInput,
        entry.botResponse,
        JSON.stringify(entry.embedding),
        entry.channelId || null,
        entry.userId || null,
        entry.userName || null,
        entry.metadata ? JSON.stringify(entry.metadata) : null
      ]);

      // Get the last inserted ID
      const result = this.db.exec('SELECT last_insert_rowid() as id')[0];
      const id = result.values[0][0] as number;

      await this.saveDatabase();

      const storedEntry: MemoryEntry = { ...entry, id };
      console.log(`[VectorStore] Stored memory entry with ID: ${id}`);
      return storedEntry;
    } catch (error) {
      console.error('[VectorStore] Error storing memory:', error);
      throw new Error(`Failed to store memory: ${error}`);
    }
  }

  /**
   * Searches for similar memories using vector similarity
   */
  async searchSimilar(
    queryEmbedding: number[], 
    limit: number = appConfig.maxMemoryResults,
    channelId?: string,
    userId?: string
  ): Promise<MemorySearchResult[]> {
    await this.ensureInitialized();
    if (!this.db) throw new Error('Database not initialized');

    try {
      // Build dynamic query based on filters
      let query = `
        SELECT id, timestamp, user_input, bot_response, embedding, channel_id, user_id, user_name, metadata
        FROM memories
      `;
      
      const conditions: string[] = [];
      const params: any[] = [];

      if (channelId) {
        conditions.push('channel_id = ?');
        params.push(channelId);
      }

      if (userId) {
        conditions.push('user_id = ?');
        params.push(userId);
      }

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      query += ' ORDER BY timestamp DESC';

      const rows = this.db.exec(query, params)[0]?.values || [];

      const results: MemorySearchResult[] = [];

      for (const row of rows) {
        const [id, timestamp, userInput, botResponse, embeddingStr, channelId, userId, userName, metadataStr] = row;
        const embedding: number[] = JSON.parse(embeddingStr as string);
        const similarity = this.calculateCosineSimilarity(queryEmbedding, embedding);

        if (similarity >= appConfig.similarityThreshold) {
          const entry: MemoryEntry = {
            id: id as number,
            timestamp: timestamp as number,
            userInput: userInput as string,
            botResponse: botResponse as string,
            embedding: embedding,
            channelId: channelId as string || undefined,
            userId: userId as string || undefined,
            userName: userName as string || undefined,
            metadata: metadataStr ? JSON.parse(metadataStr as string) : undefined
          };

          results.push({ entry, similarity });
        }
      }

      results.sort((a, b) => b.similarity - a.similarity);
      const limitedResults = results.slice(0, limit);

      console.log(`[VectorStore] Found ${limitedResults.length} similar memories (threshold: ${appConfig.similarityThreshold})`);
      return limitedResults;
    } catch (error) {
      console.error('[VectorStore] Error searching memories:', error);
      return []; // Return empty array on error instead of throwing
    }
  }

  /**
   * Gets total number of stored memories
   */
  async getMemoryCount(): Promise<number> {
    await this.ensureInitialized();
    if (!this.db) return 0;

    try {
      const result = this.db.exec('SELECT COUNT(*) as count FROM memories')[0];
      return result ? (result.values[0][0] as number) : 0;
    } catch (error) {
      console.error('[VectorStore] Error getting memory count:', error);
      return 0;
    }
  }

  /**
   * Retrieves recent memories without similarity filtering
   */
  async getRecentMemories(
    limit: number = appConfig.maxMemoryResults,
    channelId?: string,
    userId?: string
  ): Promise<MemoryEntry[]> {
    await this.ensureInitialized();
    if (!this.db) return [];

    try {
      let query = `
        SELECT id, timestamp, user_input, bot_response, embedding, channel_id, user_id, user_name, metadata
        FROM memories
      `;
      
      const conditions: string[] = [];
      const params: any[] = [];

      if (channelId) {
        conditions.push('channel_id = ?');
        params.push(channelId);
      }

      if (userId) {
        conditions.push('user_id = ?');
        params.push(userId);
      }

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(limit);

      const rows = this.db.exec(query, params)[0]?.values || [];

      const memories: MemoryEntry[] = rows.map(row => {
        const [id, timestamp, userInput, botResponse, embeddingStr, channelId, userId, userName, metadataStr] = row;
        return {
          id: id as number,
          timestamp: timestamp as number,
          userInput: userInput as string,
          botResponse: botResponse as string,
          embedding: JSON.parse(embeddingStr as string),
          channelId: channelId as string || undefined,
          userId: userId as string || undefined,
          userName: userName as string || undefined,
          metadata: metadataStr ? JSON.parse(metadataStr as string) : undefined
        };
      });

      console.log(`[VectorStore] Retrieved ${memories.length} recent memories`);
      return memories;
    } catch (error) {
      console.error('[VectorStore] Error retrieving recent memories:', error);
      return [];
    }
  }

  /**
   * Deletes a memory entry by ID
   */
  async deleteMemory(id: number): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.db) return false;

    try {
      const stmt = this.db.prepare('DELETE FROM memories WHERE id = ?');
      stmt.run([id]);
      
      const changes = this.db.getRowsModified();
      const deleted = changes > 0;
      
      if (deleted) {
        await this.saveDatabase();
        console.log(`[VectorStore] Deleted memory with ID: ${id}`);
      } else {
        console.log(`[VectorStore] Memory with ID ${id} not found`);
      }
      
      return deleted;
    } catch (error) {
      console.error('[VectorStore] Error deleting memory:', error);
      return false;
    }
  }

  /**
   * Calculates cosine similarity between two vectors
   */
  private calculateCosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vector dimensions must match for similarity calculation');
    }

    // Calculate dot product
    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
    }

    // Calculate magnitudes
    let magnitudeA = 0;
    let magnitudeB = 0;
    for (let i = 0; i < a.length; i++) {
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }
    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    // Avoid division by zero
    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    // Return cosine similarity
    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Closes the database connection and saves to disk
   */
  close(): void {
    try {
      if (this.db && this.initialized) {
        this.saveDatabase();
        this.db.close();
        console.log('[VectorStore] Database connection closed');
      }
    } catch (error) {
      console.error('[VectorStore] Error closing database:', error);
    }
  }

  /**
   * Performs database maintenance
   */
  async maintenance(): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    try {
      console.log('[VectorStore] Running database maintenance...');
      this.db.run('VACUUM');
      this.db.run('ANALYZE');
      await this.saveDatabase();
      console.log('[VectorStore] Database maintenance completed');
    } catch (error) {
      console.error('[VectorStore] Error during database maintenance:', error);
    }
  }
} 