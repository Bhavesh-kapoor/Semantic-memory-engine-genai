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
                return { "message": 'Memory stored successfully!' }
            }
            return { "message": 'something went wrong' }

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
            let query = "SELECT id , memory , (1 - (embeddings <=>$1::vector)) as similarity_score from memories where (1 - (embeddings <=>$1::vector)) > $3    order by  embeddings <=>$1::vector LIMIT $2"
            let res = await this.db.query(query, [`[${userEmbeddings.join(',')}]`, 5,0.30])
            return res.rows

        } catch (err) {
            console.log("ERROR: ", err)
            throw err
        }
    }

    askAi = async (userQuery) => {
        try {
            let memories = await this.fetchMemory(userQuery)
            console.log(memories)
            const prompt = `
                You are an AI assistant with access to the user's stored memories.

                Use the memories below to answer the user's question.

                Rules:
                - Answer only using the provided memories.
                - Do not invent or assume information.
                - If the memories do not contain enough information, say that you don't have enough information.
                - Give a concise and natural answer.

                Relevant memories:
                ${memories.map(item => `- ${item.memory}`).join('\n')}

                User question:
                ${userQuery}
                `;

            let input = [
                {
                    'role': 'system',
                    'content': prompt
                }
            ]
            let llm = await OpenAIClient.responses.create({
                model: 'gpt-4.1-nano',
                input: input,
                max_output_tokens: 300
            })
            return { output: llm.output_text, userQuestion: userQuery }
        } catch (Error) {
            console.log("ERROR WHILE GENERATING LLM RESPONSE", Error)
            throw Error
        }
    }
}

export default MemoryService