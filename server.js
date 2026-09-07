import express from 'express'
import APP_CONFIG from './src/config/utils.config.js'
import db from './src/db/connection.js'
const app = express()


app.get('/test-db-connection',async(req,res)=>{
    let test =  await db.query("SELECT NOW()");
    return res.send(test)
})


app.listen(APP_CONFIG.PORT, () => {
    console.log(`Application is running on http://locahost:${APP_CONFIG.PORT}`)
})