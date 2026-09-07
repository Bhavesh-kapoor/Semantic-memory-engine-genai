import env from 'dotenv'
env.config()

const APP_CONFIG = {
    PORT: process.env.PORT || 8010,
    DB_HOST: process.env.DB_HOST,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_NAME: process.env.DB_NAME
}
export default APP_CONFIG