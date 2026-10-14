import {
  type CloseWeekInput,
  type CloseWeekOutput,
  CloseWeekOutputSchema,
} from "../../domain/close-week";
import { executeCloseWeekDeterministic } from "./deterministic";

export class CloseWeekService {
  /**
   * Executes the deterministic weekly closing balance.
   * Compares reported item outcomes against the active weekly plan,
   * enforces item conservation, honest capacity balance, and non-punitive reflection.
   */
  public execute(input: CloseWeekInput): CloseWeekOutput {
    const rawResult = executeCloseWeekDeterministic(input);
    return CloseWeekOutputSchema.parse(rawResult);
  }
}
