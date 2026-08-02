import { collectCommands } from '../../utils/collect'

export default defineEventHandler(event => collectCommands(event))
