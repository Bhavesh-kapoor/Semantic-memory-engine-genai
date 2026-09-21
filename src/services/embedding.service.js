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

    storeMemory = async (text, user_id, memory_type, source) => {
        const client = await this.db.connect()
        try {
            await client.query('BEGIN')
            let textEmbeddings = await this.createEmbeddings(text)
            textEmbeddings = `[${textEmbeddings.join(',')}]`
            let query = "INSERT INTO memories (memory,embeddings,user_id,source ,memory_type) VALUES ($1,$2,$3,$4,$5)"
            let memory = await client.query(query, [text, textEmbeddings, user_id, source, memory_type])
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

    fetchMemory = async (userQuery, user_id) => {
        try {
            let userEmbeddings = await this.createEmbeddings(userQuery);
            let query = "SELECT id , memory , (1 - (embeddings <=>$1::vector)) as similarity_score from memories where (1 - (embeddings <=>$1::vector)) > $3 and user_id =$4    order by  embeddings <=>$1::vector LIMIT $2"
            let res = await this.db.query(query, [`[${userEmbeddings.join(',')}]`, 5, 0.30, user_id])
            return res.rows

        } catch (err) {
            console.log("ERROR: ", err)
            throw err
        }
    }

    askAi = async (userQuery,user_id) => {
        try {
            let memories = await this.fetchMemory(userQuery,user_id)
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

    memorySearch = async (query, duplcateThreasholdValue,user_id) => {
        try {
            // 1. generate user embeddings
            let userEmbeddings = await this.createEmbeddings(query);
            // 2. find the top1 memory from the database with duplicate threashold,
            let sqlQuery = "SELECT id, memory, (1 - (embeddings <=> $1::vector)) as duplicate_threashold_value FROM memories WHERE (1 - (embeddings <=> $1::vector)) > $2  and user_id = $4 order by (embeddings <=> $1::vector) LIMIT $3";
            let res = await this.db.query(sqlQuery, [`[${userEmbeddings.join(',')}]`, duplcateThreasholdValue, 1, user_id]);
            // 3 return the top1 memory
            return res.rows
        } catch (Error) {
            console.log("something went wrong", Error)
            throw Error
        }
    }

    memoryDecision = async (query, duplcateThreasholdValue,user_id) => {
        try {
            //  get the memeory search response 
            let userStoreMemory = await this.memorySearch(query, duplcateThreasholdValue, user_id);
            // if no userstore memory found then it will be insert in the db 
            let metaData = await this.memoryMetaData(query);
            if (userStoreMemory.length === 0) {
                return await this.storeMemory(query, user_id, metaData.output.memory_type, metaData.output.source)
            }
            // if similarity score if less then 0.80 but greater then or equal to 0.60  then  system will decide whether the information need to be  update or insert
            let score = Number(userStoreMemory[0].duplicate_threashold_value.toFixed(2));
            if (score > 0.80) {
                return {
                    "decision": "IGNORE",
                    "reason": "The new memory conveys the same sentiment and information as the existing memory, despite differences in capitalization and spacing."
                }
            }
            let llmdecision = await this.memoryLLMDecision(query, userStoreMemory)
            switch (llmdecision.decision) {
                case "UPDATE":
                    return await this.updateMemory(query, userStoreMemory) // update the memory
                case "INSERT":
                    return await this.storeMemory(query, user_id, metaData.output.memory_type, metaData.output.source);
                case "IGNORE":
                    return {
                        "decision": "IGNORE",
                        "reason": "The new memory conveys the same sentiment and information as the existing memory, despite differences in capitalization and spacing."
                    }
            }

        } catch (Error) {
            console.log("something went wrong", Error)
            throw Error
        }

    }

    memoryLLMDecision = async (newMemory, existingMemory) => {
        try {
            const prompt = `
            You are a memory decision engine.

            Your job is to compare an existing memory with a new memory.

            Existing memory:
            ${existingMemory[0].memory}

            New memory:
            ${newMemory}

            Choose exactly one decision:

            1. IGNORE
            - The new memory contains the same information as the existing memory.
            - No database change is required.

            2. UPDATE
            - The new memory changes, corrects, or replaces information in the existing memory.

            3. INSERT
            - The new memory contains genuinely new information.
            - It should be stored as a separate memory.

            Return JSON only.

            Required format:
            {
                "decision": "IGNORE | UPDATE | INSERT",
                "reason": "short explanation"
            }
        `;

            const response = await OpenAIClient.responses.create({
                model: "gpt-4.1-nano",
                input: [
                    {
                        role: "system",
                        content: prompt
                    }
                ],
                max_output_tokens: 150
            });

            const result = JSON.parse(response.output_text);

            // Safety validation
            const allowedDecisions = ["IGNORE", "UPDATE", "INSERT"];

            if (!allowedDecisions.includes(result.decision)) {
                throw new Error(`Invalid LLM decision: ${result.decision}`);
            }

            return {
                decision: result.decision,
                reason: result.reason || null,
                memory_id: existingMemory[0].id
            };

        } catch (error) {
            console.log("ERROR WHILE MAKING MEMORY DECISION:", error);
            throw error;
        }
    };

    updateMemory = async (newMemory, existingMemory) => {
        let client = await this.db.connect()
        try {
            await client.query("BEGIN")
            let newEmbeddings = await this.createEmbeddings(newMemory);
            let updateQuery = "UPDATE memories set memory = $1, embeddings=$2 where id = $3"
            let response = await client.query(updateQuery, [newMemory, `[${newEmbeddings.join(',')}]`, existingMemory[0].id])
            await client.query("COMMIT")
            return {
                "message": "memory updated succussfully!",
                "updatedMemory": response.rowCount
            }


        } catch (err) {
            await client.query("ROLLBACK")
            throw err;
        }
        finally {
            client.release()
        }
    }

    memoryMetaData = async (memory) => {
        try {
            let prompt = `You are a Memory Metadata Extraction Engine for an AI memory system.

            Your job is to analyze a piece of user information and extract structured metadata.

            Given a user memory, determine:

            1. memory_type
            2. source
            3. importance
            4. confidence
            5. whether this information is actually worth storing as long-term memory

            Allowed memory_type values:

            - fact
            Stable information about the user or their situation.
            Example: "I work as a backend developer."

            - preference
            User likes, dislikes, preferences, or choices.
            Example: "I prefer working remotely."

            - goal
            Something the user wants to achieve.
            Example: "I want to become a senior AI engineer."

            - skill
            Something the user knows, is learning, or has experience with.
            Example: "I am learning LangChain."

            - personal
            Personal information that may be useful for future conversations.
            Example: "I have a dog named Bruno."

            - instruction
            A persistent instruction about how the AI should interact with the user.
            Example: "Always explain concepts with practical examples."

            - temporary
            Short-lived information that is unlikely to be useful later.
            Example: "I am going to the gym today."

            - other
            Information that does not clearly fit the above categories.

            Source should represent where the memory came from.

            Allowed source values:

            - conversation
            - profile
            - manual
            - system
            - imported

            For normal user messages, use "conversation".
            user message is : ${memory}

            Importance must be:

            - low
            - medium
            - high

            Confidence must be a number between 0 and 1.

            store_memory should be true only if the information is useful for future conversations and has reasonable long-term value.

            Return JSON only.

            Required format:

            {
            "memory": "original memory text",
            "memory_type": "fact | preference | goal | skill | personal | instruction | temporary | other",
            "source": "conversation | profile | manual | system | imported",
            "importance": "low | medium | high",
            "confidence": 0.0,
            "store_memory": true,
            "reason": "short explanation"
            }

            Do not add any fields.
            Do not return markdown.
            Do not return explanations outside JSON.
             `
            let input = [{
                "role": "system",
                "content": prompt
            }]
            let llm = await OpenAIClient.responses.create({
                model: 'gpt-4.1-nano',
                input: input,
                max_output_tokens: 300
            })
            return {
                output: JSON.parse(llm.output_text),
                question: memory
            };
        } catch (err) {
            throw err;
        }
    }
}

export default MemoryService