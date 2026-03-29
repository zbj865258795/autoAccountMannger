// 本地部署模式：无需登录，直接返回已认证状态
export function useAuth() {
  return {
    user: null,
    loading: false,
    error: null,
    isAuthenticated: true,
    logout: async () => {},
    refresh: async () => {},
  };
}
