class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    Error.captureStackTrace(this, this.constructor);
  }
}

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Server error";

  if (process.env.NODE_ENV === "development") {
    return res.status(statusCode).json({
      status: err.status || "error",
      message,
      stack: err.stack,
    });
  }

  return res.status(statusCode).json({
    status: err.status || "error",
    message,
  });
};

export { AppError, errorHandler };
