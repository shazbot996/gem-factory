declare namespace google {
  namespace accounts {
    namespace id {
      interface CredentialResponse {
        credential: string;
        select_by: string;
      }

      interface PromptMomentNotification {
        isDisplayMoment: () => boolean;
        isDisplayed: () => boolean;
        isNotDisplayed: () => boolean;
        getNotDisplayedReason: () => string;
        isSkippedMoment: () => boolean;
        getSkippedReason: () => string;
        isDismissedMoment: () => boolean;
        getDismissedReason: () => string;
      }

      function initialize(config: {
        client_id: string;
        callback: (response: CredentialResponse) => void;
        auto_select?: boolean;
      }): void;

      function renderButton(
        parent: HTMLElement,
        config: { theme?: string; size?: string; width?: number },
      ): void;

      function prompt(
        callback?: (notification: PromptMomentNotification) => void,
      ): void;

      function revoke(email: string, callback: () => void): void;
    }
  }
}
