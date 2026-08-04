import { readPreferences } from '../utils/preferences'

export default defineEventHandler(async () => readPreferences())
