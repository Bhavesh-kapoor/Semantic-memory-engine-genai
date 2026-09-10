const errorHandler = (err, req, res, next) => {
    console.error(err)
    res.status(500).json({ "status": false, "message": err?.message })
}

export default errorHandler