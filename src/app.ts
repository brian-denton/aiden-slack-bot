import { App, LogLevel } from '@slack/bolt';
import { appConfig } from './config';
import { LLMService } from './services/ollama';

/**
 * Main Slack bot application class
 * Handles Slack events and integrates with LLM services
 */
class AidanSlackBot {
  private app: App;
  private llmService: LLMService;
  private activeThreads: Set<string> = new Set(); // Track threads Aidan is participating in
  private userCache: Map<string, string> = new Map(); // Cache user display names

  /**
   * Creates a new AidanSlackBot instance
   * Configures Slack app with Socket Mode and LLM service
   */
  constructor() {
    // Initialize Slack app with Socket Mode
    this.app = new App({
      token: appConfig.slackBotToken,
      signingSecret: appConfig.slackSigningSecret,
      socketMode: true,
      appToken: appConfig.slackAppToken,
      port: appConfig.port,
      logLevel: LogLevel.INFO,
    });

    // Initialize LLM service
    this.llmService = new LLMService();

    // Set up event handlers
    this.setupEventHandlers();
  }

  /**
   * Fetches user display name from Slack API with caching
   * @param userId - Slack user ID
   * @returns Promise resolving to user display name
   */
  private async getUserDisplayName(userId: string): Promise<string> {
    // Check cache first
    if (this.userCache.has(userId)) {
      return this.userCache.get(userId)!;
    }

    try {
      const userInfo = await this.app.client.users.info({
        user: userId
      });

      const user = userInfo.user as any; // Slack user object has these properties
      const userName = user?.profile?.display_name || 
                      user?.real_name || 
                      user?.name || 
                      'Unknown User';

      // Cache the result
      this.userCache.set(userId, userName);
      console.log(`[Bot] Fetched display name for ${userId}: ${userName}`);
      
      return userName;
    } catch (error) {
      console.error(`[Bot] Error fetching user info for ${userId}:`, error);
      return 'Unknown User';
    }
  }

  /**
   * Sets up all Slack event handlers
   * Configures mention detection and message processing
   */
  private setupEventHandlers(): void {
    // Add generic message listener for debugging
    this.app.event('message', async ({ event }) => {
      console.log(`[Debug] Message event received:`, event);
    });

    // Handle app mentions (when @aidan is used)
    this.app.event('app_mention', async ({ event, say }) => {
      try {
        console.log(`[Bot] Received mention from user ${event.user} in channel ${event.channel}`);
        
        // Extract the message text and remove the bot mention
        const messageText = this.extractMessageFromMention(event.text);
        
        if (!messageText.trim()) {
          await say({
            text: `Hi there! 👋 You mentioned me but didn't ask anything. How can I help you today?`,
            thread_ts: event.ts,
          });
          return;
        }

        // Get user display name
        const userId = event.user || 'unknown';
        const userName = await this.getUserDisplayName(userId);

        // Get response from LLM with user context
        const response = await this.llmService.chat(
          messageText,
          [], // conversation history
          event.channel, // channelId
          userId,        // userId
          userName       // userName
        );

        // Send the response in thread
        await say({
          text: response,
          thread_ts: event.ts,
        });

        // Track this thread as active
        const threadKey = `${event.channel}-${event.ts}`;
        this.activeThreads.add(threadKey);
        console.log(`[Bot] Added thread to active threads: ${threadKey}`);

        console.log(`[Bot] Responded to mention successfully`);
      } catch (error) {
        console.error('[Bot] Error handling mention:', error);
        
        let errorMessage = 'Sorry, I encountered an error while processing your request.';
        
        // Provide specific error messages based on error type
        if (error && typeof error === 'object' && 'code' in error) {
          switch (error.code) {
            case 'CONNECTION_REFUSED':
              errorMessage = 'I\'m having trouble connecting to my brain (Ollama). Please try again later.';
              break;
            case 'TIMEOUT':
              errorMessage = 'That took longer than expected to process. Please try a simpler question.';
              break;
            case 'MODEL_NOT_FOUND':
              errorMessage = 'My AI model seems to be unavailable. Please contact an administrator.';
              break;
          }
        }

        await say({
          text: `❌ ${errorMessage}`,
          thread_ts: event.ts,
        });
      }
    });

    // Handle direct messages to the bot
    this.app.message(async ({ message, say }) => {
      // Only respond to direct messages (DMs) and regular messages (not edited/deleted)
      if (message.channel_type === 'im' && message.subtype === undefined && 'user' in message) {
        try {
          console.log(`[Bot] Received DM from user ${message.user}`);
          
          const messageText = message.text;
          
          if (!messageText?.trim()) {
            await say('Hi! How can I help you today?');
            return;
          }

          // Get user display name
          const userId = message.user || 'unknown';
          const userName = await this.getUserDisplayName(userId);

          // Get response from LLM with user context
          const response = await this.llmService.chat(
            messageText,
            [], // conversation history
            message.channel, // channelId
            userId,          // userId
            userName         // userName
          );

          // Send the response
          await say(response);

          console.log(`[Bot] Responded to DM successfully`);
        } catch (error) {
          console.error('[Bot] Error handling DM:', error);
          await say('Sorry, I encountered an error while processing your message. Please try again.');
        }
      }
    });

    // Handle messages in active threads (where Aidan is participating)
    this.app.message(async ({ message, say }) => {
      // Only respond to channel messages in threads and regular messages (not edited/deleted)
      if (message.channel_type === 'channel' && 
          message.subtype === undefined && 
          'user' in message && 
          'thread_ts' in message && 
          message.thread_ts) {
        
        const threadKey = `${message.channel}-${message.thread_ts}`;
        
        // Check if this is a thread Aidan is participating in
        if (this.activeThreads.has(threadKey)) {
          try {
            console.log(`[Bot] Received message in active thread ${threadKey} from user ${message.user}`);
            
            const messageText = message.text;
            
            if (!messageText?.trim()) {
              return; // Don't respond to empty messages in threads
            }

            // Decide whether to respond (you can add logic here for when Aidan should respond)
            const shouldRespond = this.shouldRespondInThread(messageText);
            
            if (shouldRespond) {
              // Get user display name
              const userId = message.user || 'unknown';
              const userName = await this.getUserDisplayName(userId);

              // Get response from LLM with user context
              const response = await this.llmService.chat(
                messageText,
                [], // conversation history
                message.channel, // channelId
                userId,          // userId
                userName         // userName
              );

              // Send the response in thread
              await say({
                text: response,
                thread_ts: message.thread_ts,
              });

              console.log(`[Bot] Responded in thread ${threadKey} successfully`);
            }
          } catch (error) {
            console.error(`[Bot] Error handling thread message in ${threadKey}:`, error);
            await say({
              text: 'Sorry, I encountered an error while processing your message. Please try again.',
              thread_ts: message.thread_ts,
            });
          }
        }
      }
    });

    // Handle name mentions in channel messages (not @mentions)
    this.app.message(async ({ message, say }) => {
      // Only respond to channel messages that are not @mentions, not in threads we're already in, and regular messages
      if (message.channel_type === 'channel' && 
          message.subtype === undefined && 
          'user' in message &&
          message.text) {
        
        // Skip if this is a thread message we're already handling
        if ('thread_ts' in message && message.thread_ts) {
          const threadKey = `${message.channel}-${message.thread_ts}`;
          if (this.activeThreads.has(threadKey)) {
            return; // Already handled by thread handler
          }
        }

        // Check if the message contains "Aidan" or "aidan" (case insensitive)
        const containsName = /\b(aidan)\b/i.test(message.text);
        
        if (containsName) {
          try {
            console.log(`[Bot] Name mentioned in channel ${message.channel} by user ${message.user}`);
            
            // Ask LLM if Aidan should respond based on context
            const shouldRespond = await this.shouldRespondToNameMention(message.text);
            
            if (shouldRespond) {
              // Get user display name
              const userId = message.user || 'unknown';
              const userName = await this.getUserDisplayName(userId);

              // Get response from LLM with user context
              const response = await this.llmService.chat(
                message.text,
                [], // conversation history
                message.channel, // channelId
                userId,          // userId
                userName         // userName
              );

              // Respond in thread to avoid cluttering the channel
              const threadTs = 'thread_ts' in message && message.thread_ts ? message.thread_ts : message.ts;
              await say({
                text: response,
                thread_ts: threadTs,
              });

              // Track this thread as active if it's a new thread
              if (!('thread_ts' in message && message.thread_ts)) {
                const threadKey = `${message.channel}-${message.ts}`;
                this.activeThreads.add(threadKey);
                console.log(`[Bot] Added new thread to active threads: ${threadKey}`);
              }

              console.log(`[Bot] Responded to name mention successfully`);
            } else {
              console.log(`[Bot] Decided not to respond to name mention based on context`);
            }
          } catch (error) {
            console.error('[Bot] Error handling name mention:', error);
            // Don't send error messages for name mentions to avoid spam
          }
        }
      }
    });

    // Handle app_home_opened event (when user opens the bot's home tab)
    this.app.event('app_home_opened', async ({ event, client }) => {
      try {
        await client.views.publish({
          user_id: event.user,
          view: {
            type: 'home',
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*Welcome to Aidan! 🤖*\n\nI'm your AI assistant powered by Ollama. Here's how to interact with me:`,
                },
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `• *Mention me* in any channel: \`@${appConfig.botName} your question\` (I'll respond in a thread)\n• *Say my name* in conversation: I'll decide if I should join in based on context\n• *Continue the conversation* in threads - I might participate!\n• *Send me a DM* for private conversations\n• I can help with questions, provide information, and have conversations!`,
                },
              },
              {
                type: 'divider',
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*Current Model:* \`${appConfig.llmModel}\`\n*Current Provider:* \`${appConfig.llmProvider}\`\n*Status:* 🟢 Online and ready to help!`,
                },
              },
            ],
          },
        });
      } catch (error) {
        console.error('[Bot] Error updating home tab:', error);
      }
    });

    // Global error handler
    this.app.error(async (error) => {
      console.error('[Bot] Global error:', error);
    });
  }

  /**
   * Extracts the actual message content from a mention event
   * Removes the bot mention tag and cleans up the text
   * @param text - The raw text from the mention event
   * @returns Cleaned message text
   */
  private extractMessageFromMention(text: string): string {
    // Remove the mention pattern (e.g., "<@U1234567890>")
    const mentionPattern = /<@[A-Z0-9]+>/g;
    return text.replace(mentionPattern, '').trim();
  }

  /**
   * Determines whether Aidan should respond to a message in a thread
   * @param messageText - The message text to analyze
   * @returns Whether Aidan should respond
   */
  private shouldRespondInThread(messageText: string): boolean {
    // Simple logic: respond to questions or if the message is interesting
    const hasQuestionWords = /\b(what|how|why|when|where|who|can|could|would|should|is|are|will|do|does|did)\b/i.test(messageText);
    const hasQuestionMark = messageText.includes('?');
    const isQuestion = hasQuestionWords || hasQuestionMark;
    
    // Also respond if the message is longer (indicates engagement)
    const isSubstantial = messageText.trim().length > 20;
    
    // Respond to questions or substantial messages (about 50% of the time for substantial non-questions)
    if (isQuestion) {
      return true;
    } else if (isSubstantial) {
      return Math.random() < 0.5; // 50% chance for substantial messages
    }
    
    return false; // Don't respond to short non-questions
  }

  /**
   * Uses LLM to determine if Aidan should respond to a name mention based on context
   * @param messageText - The message text to analyze
   * @returns Promise<boolean> - Whether Aidan should respond
   */
  private async shouldRespondToNameMention(messageText: string): Promise<boolean> {
    try {
      const contextPrompt = `You are Aidan, a helpful AI assistant in a Slack channel. Someone just mentioned your name "Aidan" in this message: "${messageText}"

Based on the context, should you respond? Consider:
- Are they asking you a question or seeking your input?
- Are they talking TO you vs ABOUT you?
- Is it a casual mention that doesn't need a response?
- Would responding add value to the conversation?

Respond with only "YES" if you should respond, or "NO" if you should stay quiet.`;

      const decision = await this.llmService.chat(contextPrompt);
      const shouldRespond = decision.trim().toUpperCase().startsWith('YES');
      
      console.log(`[Bot] LLM decision for "${messageText.substring(0, 50)}...": ${shouldRespond ? 'RESPOND' : 'STAY_QUIET'}`);
      return shouldRespond;
    } catch (error) {
      console.error('[Bot] Error getting LLM decision for name mention:', error);
      // Default to not responding if there's an error
      return false;
    }
  }

  /**
   * Starts the Slack bot application
   * Tests Ollama connection and starts listening for events
   */
  async start(): Promise<void> {
    try {
      console.log('[Bot] Starting Aidan Slack Bot...');
      
      // Test LLM connection
      console.log(`[Bot] Testing ${appConfig.llmProvider} connection...`);
      await this.llmService.testConnection();
      
      // Get available models for logging
      try {
        const models = await this.llmService.listModels();
        console.log(`[Bot] Available ${appConfig.llmProvider} models: ${models.join(', ')}`);
      } catch (error) {
        console.warn('[Bot] Could not retrieve available models:', error);
      }

      // Start the Slack app
      await this.app.start();
      
      console.log(`🚀 Aidan Slack Bot is running!`);
      console.log(`📡 Bot name: ${appConfig.botName}`);
      console.log(`🧠 ${appConfig.llmProvider} model: ${appConfig.llmModel}`);
      console.log(`🔗 ${appConfig.llmProvider} URL: ${appConfig.llmBaseUrl}`);
      console.log(`⚡ Ready to respond to mentions and DMs!`);
    } catch (error) {
      console.error('[Bot] Failed to start:', error);
      process.exit(1);
    }
  }

  /**
   * Gracefully stops the bot
   */
  async stop(): Promise<void> {
    try {
      await this.app.stop();
      console.log('[Bot] Stopped successfully');
    } catch (error) {
      console.error('[Bot] Error stopping bot:', error);
    }
  }
}

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  const bot = new AidanSlackBot();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Bot] Received SIGINT, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[Bot] Received SIGTERM, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });

  // Start the bot
  await bot.start();
}

// Run the application
if (require.main === module) {
  main().catch((error) => {
    console.error('[Bot] Fatal error:', error);
    process.exit(1);
  });
}

export { AidanSlackBot }; 