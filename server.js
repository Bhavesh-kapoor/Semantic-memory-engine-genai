import express from 'express'
import APP_CONFIG from './src/utils/config.utils.js'
import db from './src/db/connection.js'
const app = express()
// make terminal interface 
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from "node:process"
import MemoryService from './src/services/embedding.service.js';


// create  interface
let r1 = readline.createInterface({ input, output })
const askQuestion = async (firstTime) => {
    try {
        let ask = firstTime ? "Ask Something: " : '';
        let userQuery = await r1.question(ask)
        if (userQuery == 'exit') {
            r1.close();
            return
        }

        // create embeddings of it 
        let memory = new MemoryService()
        let userembeddings = await memory.createEmbeddings(userQuery);
        console.log("user embeddings: ", userembeddings)
        askQuestion()



    } catch (err) {
        console.log(err)
    }
}
await askQuestion(true)



app.listen(APP_CONFIG.PORT, () => {
    console.log(`Application is running on http://locahost:${APP_CONFIG.PORT}`)
})