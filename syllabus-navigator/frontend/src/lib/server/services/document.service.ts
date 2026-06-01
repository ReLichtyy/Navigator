import { DocumentRepository } from "../repositories/document.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import crypto from "crypto"

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export const DocumentService = {
  async processUpload(userId: string, file: File) {
    if (file.type !== "application/pdf") {
      throw new ApiErrorResponse("Only PDF files are allowed.", 400)
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new ApiErrorResponse(`File size exceeds the 5MB limit. (Got ${(file.size / 1024 / 1024).toFixed(2)}MB)`, 400)
    }

    // In a real environment we would upload `file` to S3 or similar and extract a real hash.
    // For now we mock the storage and source hash.
    const mockSourceHash = crypto.randomUUID()
    
    return DocumentRepository.createUpload(userId, file.name, mockSourceHash)
  }
}
