import OpenAIClient from "../utils/openai.utils.js";
import db from "../db/connection.js";
class MemoryService {

    constructor() {
        this.db = db
        this.embedding_model = 'text-embedding-3-small'
    }

    createEmbeddings = async (text) => {
        try {
            let response = await OpenAIClient.embeddings.create({
                input: text,
                model: this.embedding_model
            })
            return response.data[0].embedding
        } catch (err) {
            console.log(err)
            throw err
        }
    }

    storeMemory = async (text) => {
        const client = await this.db.connect()
        try {
            await client.query('BEGIN')
            let textEmbeddings = await this.createEmbeddings(text)
            textEmbeddings = `[${textEmbeddings.join(',')}]`
            let query = "INSERT INTO memories (memory,embeddings) VALUES ($1 ,$2)"
            let memory = await client.query(query, [text, textEmbeddings])
            await client.query('COMMIT')
            if (memory.rowCount > 0) {
                return JSON.stringify({ "message": 'Memory stored successfully!' })
            }
            return JSON.stringify({ "message": 'something went wrong' })

        } catch (err) {
            await client.query('ROLLBACK')
            console.log(err)
            throw err
        } finally {
            client.release()
        }

    }

    fetchMemory = async (userQuery) => {
        try {
            let userEmbeddings = await this.createEmbeddings(userQuery);
            let query = "SELECT id , memory , (1 - (embeddings <=>$1::vector)) as similarity_score from memories  order by  embeddings <=>$1::vector LIMIT $2"
            let res = await this.db.query(query, [`[${userEmbeddings.join(',')}]`, 5])
            return res.rows

        } catch (err) {
            console.log("ERROR: ", err)
            throw err
        }
    }



}

export default MemoryService