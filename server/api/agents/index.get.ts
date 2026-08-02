import { collectAgents } from '../../utils/collect'

export default defineEventHandler(event => collectAgents(event))
