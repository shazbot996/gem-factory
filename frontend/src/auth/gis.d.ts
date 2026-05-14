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

    namespace oauth2 {
      interface TokenResponse {
        access_token: string;
        expires_in: number;
        token_type: string;
        scope: string;
        error?: string;
        error_description?: string;
      }

      interface TokenClient {
        requestAccessToken(overrideConfig?: { prompt?: string; hint?: string }): void;
      }

      function initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        prompt?: string;
        hint?: string;
      }): TokenClient;

      function revoke(accessToken: string, done?: () => void): void;
    }
  }
}
