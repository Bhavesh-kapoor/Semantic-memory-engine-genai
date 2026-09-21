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

    storeMemory = async (text, user_id, memory_type, source, importance) => {
        const client = await this.db.connect()
        try {
            await client.query('BEGIN')
            let textEmbeddings = await this.createEmbeddings(text)
            textEmbeddings = `[${textEmbeddings.join(',')}]`
            let query = "INSERT INTO memories (memory,embeddings,user_id,source ,memory_type,importance) VALUES ($1,$2,$3,$4,$5,$6)"
            let memory = await client.query(query, [text, textEmbeddings, user_id, source, memory_type, importance])
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

    askAi = async (userQuery, user_id) => {
        try {
            let memories = await this.fetchMemory(userQuery, user_id)
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

    memorySearch = async (query, duplcateThreasholdValue, user_id) => {
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

    memoryDecision = async (query, duplcateThreasholdValue, user_id) => {
        try {
            //  get the memeory search response 
            let userStoreMemory = await this.memorySearch(query, duplcateThreasholdValue, user_id);
            let score = userStoreMemory.length > 0 ? Number(userStoreMemory[0].duplicate_threashold_value.toFixed(2)) : 0;
            if (score > 0.80) {
                return {
                    "decision": "IGNORE",
                    "reason": "The new memory conveys the same sentiment and information as the existing memory, despite differences in capitalization and spacing."
                }
            }
            let llmdecision = await this.memoryLLMDecision(query, userStoreMemory)
            console.log("llmdecision", llmdecision)
            switch (llmdecision.decision) {
                case "UPDATE":
                    return await this.updateMemory(query, userStoreMemory) // update the memory
                case "INSERT":
                    return await this.storeMemory(query, user_id, llmdecision.memory_type, llmdecision.source, llmdecision.importance);
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

            Your job is to compare an existing memory with a new memory and classify the new memory.

            Existing memory:
            ${existingMemory.length > 0 ? existingMemory[0].memory : 'nothing'}   

            New memory:
            ${newMemory}


            DECISION:

            Choose exactly one:

            1. IGNORE
            - New memory contains the same information as existing memory.
            - No database change is required.

            2. UPDATE
            - New memory changes, corrects, or replaces information in existing memory.

            3. INSERT
            - New memory contains genuinely new information.
            - It should be stored as a separate memory.


            MEMORY TYPE:

            Choose exactly one:

            - preference: User likes, dislikes, or preferences.
            - goal: Something the user wants to achieve.
            - skill: A skill, technology, or capability the user has.
            - fact: Stable information about the user.
            - context: Temporary or situational information.
            - relationship: Information about people or relationships.
            - project: Information about a user's project or work.
            - other: If none of the above apply.


            SOURCE:

            Choose exactly one:

            - conversation: Information explicitly provided by the user.
            - system: Information generated by the system.
            - imported: Information imported from an external source.
            - other: If none of the above apply.


            IMPORTANCE:

            Give a number between 0 and 1.

            0 = almost useless for future conversations
            1 = extremely useful for future conversations.


            IMPORTANT RULES:

            - Do not invent information.
            - Use only the information present in the memories.
            - Return valid JSON only.
            - Do not add markdown.
            - Do not add explanations outside JSON.


            Required JSON format:

            {
                "decision": "IGNORE | UPDATE | INSERT",
                "reason": "short explanation",
                "memory_type": "preference | goal | skill | fact | context | relationship | project | other",
                "source": "conversation | system | imported | other",
                "importance": 0.0
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
                max_output_tokens: 200
            });

            const result = JSON.parse(response.output_text);

            // Validation
            const allowedDecisions = [
                "IGNORE",
                "UPDATE",
                "INSERT"
            ];

            const allowedMemoryTypes = [
                "preference",
                "goal",
                "skill",
                "fact",
                "context",
                "relationship",
                "project",
                "other"
            ];

            const allowedSources = [
                "conversation",
                "system",
                "imported",
                "other"
            ];

            if (!allowedDecisions.includes(result.decision)) {
                throw new Error(`Invalid decision: ${result.decision}`);
            }

            if (!allowedMemoryTypes.includes(result.memory_type)) {
                throw new Error(`Invalid memory type: ${result.memory_type}`);
            }

            if (!allowedSources.includes(result.source)) {
                throw new Error(`Invalid source: ${result.source}`);
            }

            if (
                typeof result.importance !== "number" ||
                result.importance < 0 ||
                result.importance > 1
            ) {
                throw new Error(`Invalid importance: ${result.importance}`);
            }

            return {
                decision: result.decision,
                reason: result.reason || null,
                memory_type: result.memory_type,
                source: result.source,
                importance: result.importance,
                memory_id: existingMemory[0]?.id || null
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