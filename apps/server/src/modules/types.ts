import type { Config } from '../config'
import type { Db } from '../db/client'

/** Options every API module plugin receives (registered under the /api prefix). */
export interface ModuleOptions {
  db: Db
  config: Config
}
