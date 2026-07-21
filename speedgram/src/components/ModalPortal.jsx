import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';

const ModalPortal = ({ children }) => {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  return createPortal(children, document.body);
};

ModalPortal.propTypes = { children: PropTypes.node.isRequired };

export default ModalPortal;
