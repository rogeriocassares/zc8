"use client";

import { useEffect, useState } from "react";

export default function Page() {
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    const eventSource = new EventSource("/api/sse");
    eventSource.onmessage = (event) => {
      console.log("SSE Message:", event.data);
    };

    eventSource.onerror = (err) => {
      console.error("SSE Error:", err);
    };

    // eventSource.onopen = () => {
    //   console.log("Connected to Elysia SSE");
    // };

    eventSource.onmessage = (event) => {
      const data = event.data;
      console.log("Received:", data);
      setMessages((prev) => [...prev, data]);
    };

    eventSource.onerror = (err) => {
      console.error("SSE Error:", err);
    };

    // Cleanup on unmount
    return () => {
      eventSource.close();
    };
  }, []);

  return (
    <div>
      <h2>Live Messages</h2>
      <ul>
        {messages.map((msg, i) => (
          <li key={i}>{msg}</li>
        ))}
      </ul>
    </div>
  );
}
