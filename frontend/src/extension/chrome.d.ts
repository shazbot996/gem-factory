declare namespace chrome {
  namespace runtime {
    function sendMessage(
      extensionId: string,
      message: unknown,
      callback: (response: unknown) => void,
    ): void;
    const lastError: { message: string } | undefined;
  }
}
