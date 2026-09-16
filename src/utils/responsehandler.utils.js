const responseHandler = (res, data = null, message = "Sucess", statusCode = 200) => {
    return res.status(statusCode).json({
        success: true,
        data,
        message
    })
}
    export default responseHandler