import MemoryService from "../services/embedding.service.js";
import asyncHandler from "../utils/asynHanlder.utils.js";
import responseHandler from "../utils/responsehandler.utils.js";

class MemoryController {

    constructor() {
        this.memoryService = new MemoryService()
    }

    store = asyncHandler(async (req, res) => {
        const { memory } = req.body
        if (!memory) { return responseHandler(res, null, 'memory is required', 400) }
        const result = await this.memoryService.storeMemory(memory)
        return responseHandler(res, null, result.message, 200)
    })

    search = asyncHandler(async (req, res) => {
        const { query } = req.body
        if (!query) { return responseHandler(res, null, 'user query  is required', 400) }
        const result = await this.memoryService.fetchMemory(query)
        return responseHandler(res, null, result, 200)
    })

    llmCall = asyncHandler(async (req, res) => {
        const { query } = req.body
        if (!query) { return responseHandler(res, null, 'user query  is required', 400) }
        const result = await this.memoryService.askAi(query)
        return responseHandler(res, result, "response generated successfully!", 200)
    })

    memorySearch = asyncHandler(async (req, res) => {
        const { query } = req.body
        if (!query) { return responseHandler(res, null, 'user query  is required', 400) }
        let response = await this.memoryService.memoryDecision(query, 0.61)

        return responseHandler(res, response, "memory fetched successfully!", 200)

    })





}

export default new MemoryController()