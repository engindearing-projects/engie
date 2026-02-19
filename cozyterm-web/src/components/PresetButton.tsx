import { colors } from '../theme/colors';
import styles from './PresetButton.module.css';

interface Props {
  label: string;
  onPress: () => void;
  active?: boolean;
}

export function PresetButton({ label, onPress, active = false }: Props) {
  return (
    <button
      className={styles.button}
      onClick={onPress}
      style={{
        backgroundColor: active ? colors.cyan : colors.bgLight,
        color: active ? colors.bg : colors.cyan,
        borderColor: active ? colors.cyan : colors.cyanDim,
      }}
    >
      {label}
    </button>
  );
}
