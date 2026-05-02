import { chatApi, type ChatCommandInfo } from '../../api'

let commandCache: ChatCommandInfo[] | null = null
let commandCachePromise: Promise<ChatCommandInfo[]> | null = null

export async function getSlashCommands(): Promise<ChatCommandInfo[]> {
  if (commandCache) {
    return commandCache
  }

  if (!commandCachePromise) {
    commandCachePromise = chatApi.listCommands()
      .then(result => {
        commandCache = result
        return result
      })
      .finally(() => {
        commandCachePromise = null
      })
  }

  const commands = await commandCachePromise
  return Array.isArray(commands) ? commands : []
}

/**
 * Invalidate the commands cache.
 * Call this after creating, updating, or deleting skills that provide slash commands.
 */
export function invalidateCommandsCache(): void {
  commandCache = null
}
