import { Response } from "express";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number = 500) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export const getUserId = (req: any): string => {
  if (!req.auth || !req.auth.userId) {
    throw new ApiError("Unauthorized", 401);
  }
  return req.auth.userId;
};

export const handleApiError = (error: any, res: Response) => {
  if (error instanceof ApiError) {
    return res.status(error.status).json({ error: error.message });
  }
  
  if (error?.name === "ValidationError") {
    return res.status(400).json({ error: "Invalid data provided." });
  }

  // Handle other known Mongoose or system errors here if needed
  if (error?.code === 11000) {
    return res.status(409).json({ error: "Duplicate entry detected." });
  }

  console.error("Unhandled API Error:", error);
  res.status(500).json({ error: "An internal server error occurred." });
};
