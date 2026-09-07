import { Pool } from "pg";
import APP_CONFIG from '../config/utils.config.js'

const db = new Pool({
    user: APP_CONFIG.DB_USER,
    host: APP_CONFIG.DB_HOST,
    database: APP_CONFIG.DB_NAME,
    password: APP_CONFIG.DB_PASSWORD,
    port: 5432,
})

export default db