import fs from "original-fs";
import path from "path";
import * as Sentry from '@sentry/electron/main';
import logger from '../logger';

const CRASH_FILE = path.resolve("./crash.log");

export class HandleErrorsElectron {
    public static handleError(className: string, method: string, block: string, error: unknown): void {
        try {
            const errorObj = error instanceof Error ? error : new Error(String(error));
            const sentryContext = `${className}/${method}/${block}:${errorObj.message}`;
            const errorMessage = HandleErrorsElectron.formatLogMessage("ERROR", sentryContext, errorObj.stack || errorObj.message);

            HandleErrorsElectron.storeCrash(errorMessage);

            const currentUser = Sentry.getCurrentScope().getUser() ?? null;

            Sentry.withScope(scope => {
                scope.setTag("module", className);
                scope.setTag("method", method);
                scope.setTag("block", block);
                scope.setUser(currentUser);
                scope.setFingerprint([sentryContext]);
                scope.setTransactionName(sentryContext);
                scope.setExtra("error_stack", errorObj.stack || "no_stack_trace");

                scope.captureException(errorObj)
            });
        } catch (internalError) {
            logger.main.error("Ошибка внутри ErrorService.handleError:", internalError);
        }
    }

    public static processStoredCrashes(): void {
        if (!fs.existsSync(CRASH_FILE)) return;

        try {
            const crashData = fs.readFileSync(CRASH_FILE, "utf-8");
            if (crashData.trim()) {
                fs.unlinkSync(CRASH_FILE);
                Sentry.captureMessage(`Stored crashes:\n${crashData}`);
            }
        } catch (error) {
            this.handleError("error_handler", "process_stored_crashes", "crash_file_handling", error);
        }
    }

    private static formatLogMessage(type: "INFO" | "ERROR", source: string, message: string): string {
        return `[${new Date().toISOString()}] [${type}] [${source}] ${message}`;
    }

    private static storeCrash(errorMessage: string): void {
        try {
            fs.appendFileSync(CRASH_FILE, `${errorMessage}\n`);
        } catch (fsError) {
            logger.main.error("Ошибка записи в crash.log:", fsError);
        }
    }
}
