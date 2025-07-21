import React, { ReactNode } from "react";
import ReactDOM from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import ButtonV2 from "../../buttonV2";
import * as styles from "./CustomModalPS.module.scss";

export interface ModalButton {
  text: string;
  onClick: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  className?: string;
}

export interface CustomModalPSProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  text?: string;
  children?: ReactNode;
  buttons?: ModalButton[];
}

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
} as const;

const modalVariants = {
  hidden: { opacity: 0, scale: 0.95, y: -20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.2, type: "spring", stiffness: 260, damping: 20 },
  },
  exit: { opacity: 0, scale: 0.95, y: -20, transition: { duration: 0.15 } },
} as const;

const CustomModalPS: React.FC<CustomModalPSProps> = ({
  isOpen,
  onClose,
  title,
  text,
  children,
  buttons = [],
}) => {
  if (typeof window === "undefined") return null;

  const renderButtons = () => {
    if (!buttons.length) return null;
    return (
      <div className={styles.buttonsWrapper}>
        {buttons.map(({ text, onClick, variant = "primary", disabled, className }, idx) => {
          const variantClass =
            styles[`btn_${variant}` as keyof typeof styles] || styles.btn_primary;

          return (
            <ButtonV2
              key={idx}
              onClick={onClick}
              disabled={disabled}
              className={`${variantClass}${className ? ` ${className}` : ""}`}
            >
              {text}
            </ButtonV2>
          );
        })}
      </div>
    );
  };

  return ReactDOM.createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="backdrop"
          className={styles.backdrop}
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={onClose}
        >
          <motion.div
            key="modal"
            className={styles.modal}
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            {title && <h2 className={styles.title}>{title}</h2>}
            {text && <p className={styles.text}>{text}</p>}
            {children}
            {renderButtons()}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default CustomModalPS;
