import React, { useEffect, useRef } from 'react';
import * as cm from './contextMenu.module.scss';
import { SectionConfig } from './sectionConfig';

interface ContextMenuProps {
  items: SectionConfig[];
  position: { x: number; y: number };
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ items, position, onClose }) => {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className={cm.contextMenu}
      style={{ top: position.y, left: position.x }}
    >
      {items.filter(item => item.show).map((item, index) => (
        <div key={index} className={cm.contextMenuItem} onClick={item.onClick}>
          {item.label}
        </div>
      ))}
    </div>
  );
};

export default ContextMenu;
