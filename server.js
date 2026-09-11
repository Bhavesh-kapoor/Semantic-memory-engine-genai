import express from 'express'
import APP_CONFIG from './src/utils/config.utils.js'
import memoryRouter from './src/routes/memory.routes.js'
import errorHandler from './src/utils/errorhandler.utils.js';
const app = express()

app.use(express.json());
app.use('/memory', memoryRouter)


app.use(errorHandler)

app.listen(APP_CONFIG.PORT, '0.0.0.0', () => {
    console.log(`Application is running on http://locahost:${APP_CONFIG.PORT}`)
})