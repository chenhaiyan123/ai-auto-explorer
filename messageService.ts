
import { Message } from '../types_message';

// 假设后端运行在 3001 端口
const API_BASE_URL = 'http://localhost:3001/api';

export const getMessages = async (): Promise<Message[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/messages`);
    if (!response.ok) throw new Error('Failed to fetch messages');
    return await response.json();
  } catch (error) {
    console.error('Error in getMessages:', error);
    return [];
  }
};

export const postMessage = async (username: string, content: string): Promise<Message> => {
  try {
    const response = await fetch(`${API_BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, content }),
    });
    if (!response.ok) throw new Error('Failed to post message');
    return await response.json();
  } catch (error) {
    console.error('Error in postMessage:', error);
    throw error;
  }
};
