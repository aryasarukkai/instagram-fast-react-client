
export const isLoggedIn = () => {
    const session = localStorage.getItem('ig_session');
    return session !== null;
  };
  