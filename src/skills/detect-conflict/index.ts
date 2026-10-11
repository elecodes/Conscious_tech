import {
  DetectConflictInput,
  DetectConflictInputSchema,
  DetectConflictOutput,
} from "../../domain/conflict";
import { detectConflictsDeterministically } from "./deterministic";

export class DetectConflictService {
  async detect(input: DetectConflictInput): Promise<DetectConflictOutput> {
    const validatedInput = DetectConflictInputSchema.parse(input);
    return detectConflictsDeterministically(validatedInput);
  }
}
