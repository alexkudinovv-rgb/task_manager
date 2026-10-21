// CLI: npm run create-owner -w apps/server -- --login <login> --first <Имя> --last <Фамилия> [--reset]
// Creates the single owner and prints an invite link. With --reset and an existing owner, issues a fresh
// invite for them instead (clears password, 2FA, recovery codes and sessions, like the admin reset).
import { parseArgs } from 'node:util'
import { CreateUserInput } from '@car-city/shared/model'
import { z } from 'zod'
import { loadConfig } from '../config'
import { createDb } from '../db/client'
import { ApiHttpError } from '../http/errors'
import { createOwner, findOwner, OwnerExistsError, resetOwner } from '../modules/auth/service'

const USAGE = 'Использование: npm run create-owner -w apps/server -- --login <логин> --first <Имя> --last <Фамилия> [--reset]'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

let args: { login?: string, first?: string, last?: string, reset?: boolean }
try {
  args = parseArgs({
    options: {
      login: { type: 'string' },
      first: { type: 'string' },
      last: { type: 'string' },
      reset: { type: 'boolean', default: false },
    },
  }).values
} catch (error) {
  fail(`${(error as Error).message}\n${USAGE}`)
}

const config = loadConfig()
if (!config.DATABASE_URL) fail('DATABASE_URL не задан. Скопируйте apps/server/.env.example в apps/server/.env.')

const { db, close } = createDb(config.DATABASE_URL, { max: 1 })
try {
  const owner = await findOwner(db)
  if (owner && !args.reset) {
    fail(`Собственник уже есть (логин ${owner.login}). Чтобы выдать ему новую ссылку-приглашение, добавьте --reset.`)
  }
  if (owner) {
    const result = await resetOwner(db, config.PUBLIC_URL)
    if (!result) fail('Собственник не найден')
    console.log(`Доступ собственника ${result.owner.login} сброшен: пароль, 2FA и сессии удалены.`)
    console.log(`Ссылка-приглашение (действует до ${result.link.expiresAt}):`)
    console.log(result.link.inviteUrl)
  } else {
    const parsed = CreateUserInput.pick({ login: true, firstName: true, lastName: true }).safeParse({
      login: args.login,
      firstName: args.first,
      lastName: args.last,
    })
    if (!parsed.success) fail(`${z.prettifyError(parsed.error)}\n${USAGE}`)
    const created = await createOwner(db, parsed.data, config.PUBLIC_URL)
    console.log(`Собственник ${created.user.login} создан.`)
    console.log(`Ссылка-приглашение (действует до ${created.expiresAt}):`)
    console.log(created.inviteUrl)
  }
} catch (error) {
  if (error instanceof OwnerExistsError) {
    console.error(error.message)
  } else if (error instanceof ApiHttpError && error.body.error === 'login_taken') {
    console.error('Такой логин уже занят')
  } else {
    console.error('Не удалось создать собственника:', (error as Error).message)
  }
  process.exitCode = 1
} finally {
  await close()
}
