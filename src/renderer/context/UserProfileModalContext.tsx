import React, { createContext, useContext, useState } from 'react';
import UserProfileModal from '../components/userProfileModal';

export type UserProfileModalContextType = {
  openUserProfile: (username: string) => void;
  closeUserProfile: () => void;
};

const UserProfileModalContext = createContext<UserProfileModalContextType>({
  openUserProfile: () => {},
  closeUserProfile: () => {},
});

export const UserProfileModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [isModalOpen, setModalOpen] = useState(false);

  const openUserProfile = (username: string) => {
    setSelectedUser(username);
    setModalOpen(true);
  };

  const closeUserProfile = () => {
    setModalOpen(false);
    setTimeout(() => {
      setSelectedUser(null);
    }, 300);
  };

  return (
    <UserProfileModalContext.Provider value={{ openUserProfile, closeUserProfile }}>
      {children}
      <UserProfileModal
        isOpen={isModalOpen}
        onClose={closeUserProfile}
        username={selectedUser || ''}
      />
    </UserProfileModalContext.Provider>
  );
};

export const useUserProfileModal = () => useContext(UserProfileModalContext);
